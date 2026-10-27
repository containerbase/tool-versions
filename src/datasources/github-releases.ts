import { env } from 'node:process';
import { z } from 'zod';
import { reportSkippedDownloads } from '../download.ts';
import {
  type FileCandidate,
  type PreviousFiles,
  type ToolFiles,
  assetTasks,
  checksumTasks,
  isUnsupportedDistro,
  mayCompute,
  parsePrebuildName,
  runAll,
  tagPrefixes,
  withFiles,
} from '../files.ts';
import { request } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { belowMinimum, versionings } from '../versioning.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';

const GithubAsset = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  // like `sha256:<hex>`, computed by GitHub for assets uploaded since 2025
  digest: z.string().nullish(),
});
type GithubAsset = z.infer<typeof GithubAsset>;

const GithubReleases = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().nullish(),
    assets: z.array(GithubAsset).default([]),
  }),
);

/**
 * Extracts the url of the next page from a GitHub `link` header.
 * @param link - the header value
 * @returns the url, or `undefined` on the last page
 */
export function nextPage(link: string | null): string | undefined {
  return link
    ?.split(',')
    .map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1])
    .find((url) => url !== undefined);
}

/**
 * The GitHub api request headers, authenticated with `GITHUB_TOKEN` when it is
 * set.
 */
function githubHeaders(): Record<string, string> {
  const token = env['GITHUB_TOKEN'];
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token && { authorization: `Bearer ${token}` }),
  };
}

/**
 * Finds the release files which have a `<file>.sha512` sibling. The arch and
 * distro are read from the file name, files of unsupported distros are skipped.
 * @param assets - the files of a release
 */
function assetCandidates(assets: GithubAsset[]): FileCandidate[] {
  const urls = new Map(
    assets.map(({ name, browser_download_url }) => [name, browser_download_url]),
  );
  return assets.flatMap(({ name, browser_download_url }) => {
    const checksumUrl = urls.get(`${name}.sha512`);
    const parsed = parsePrebuildName(name);
    return checksumUrl && !isUnsupportedDistro(parsed.distro)
      ? [
          {
            name,
            url: browser_download_url,
            checksumUrls: [checksumUrl],
            algorithm: 'sha512' as const,
            ...parsed,
          },
        ]
      : [];
  });
}

/**
 * Creates the tasks which read the checksums of the files of a release: the
 * files of an asset template, the ones a template function lists, or the
 * assets with a `<file>.sha512` sibling.
 * @param packageName - the repository, used in warnings
 * @param template - how the files of a version are listed, if the tool has one
 * @param version - the version of the release
 * @param assets - the assets of the release
 * @param files - the known files of the version, the downloads add to it
 */
function releaseTasks(
  packageName: string,
  template: ToolFiles | undefined,
  version: string,
  assets: GithubAsset[],
  files: ToolFile[],
): (() => Promise<void>)[] {
  if (typeof template === 'object') {
    const byName = new Map(
      assets.map(({ name, browser_download_url, digest }) => [
        name,
        { url: browser_download_url, digest },
      ]),
    );
    return assetTasks(packageName, template, version, byName, files);
  }
  const candidates = template ? template(version) : assetCandidates(assets);
  return checksumTasks(packageName, candidates, files);
}

/**
 * Fetches the releases of a GitHub repository. The leading `v` of a tag is
 * dropped, as `install-tool` does, or the first tag prefix of the template the
 * tag starts with; tags without one of them are skipped. Drafts
 * and tags which are no valid version are skipped. A release is a prerelease when GitHub marks it as one or
 * its version has a prerelease part.
 * GitHub lists the newest releases first, so paging stops after the first page
 * with an already known version.
 * The files are the assets with a `<file>.sha512` sibling, or the ones the
 * template lists, from the assets or elsewhere. Known files are reused by name, only the missing ones are
 * downloaded.
 * @param packageName - the repository, like `helm/helm`
 * @param known - the versions which are already known
 * @param previous - the already known files by version
 * @param template - lists the files of a version, instead of the assets
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, the release time is part of the release list
 * @param versioning - which tags are valid versions, which are prereleases and
 * how they are sorted, `semver` by default
 * @param minVersion - the oldest version to read, older releases are skipped
 * so their files aren't downloaded
 */
export async function fetchGithubReleases(
  packageName: string,
  known: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'semver',
  minVersion?: string,
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const isTooOld = belowMinimum(versioning, minVersion);
  const prefixes = tagPrefixes(template);
  const headers = githubHeaders();
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  let url: string | undefined = `https://api.github.com/repos/${packageName}/releases?per_page=100`;
  while (url) {
    const res = await request(url, headers);
    let foundKnown = false;
    for (const release of GithubReleases.parse(await res.json())) {
      const prefix = prefixes?.find((p) => release.tag_name.startsWith(p));
      if (prefixes !== undefined && prefix === undefined) {
        // a tag of something else in the repository
        continue;
      }
      const version =
        prefix === undefined
          ? release.tag_name.replace(/^v/, '')
          : release.tag_name.slice(prefix.length);
      if (release.draft || !isValid(version) || isTooOld(version)) {
        continue;
      }
      foundKnown ||= known.has(version);
      const entry = toolVersion(version, {
        prerelease: release.prerelease || isPrerelease(version),
        releaseTimestamp: toTimestamp(release.published_at),
      });
      const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
      if (fetchFiles) {
        tasks.push(...releaseTasks(packageName, template, version, release.assets, files));
      }
      versions.push({ entry, files });
    }
    // files which are computed by downloading them are filled newest first over
    // several builds, so all releases are read to find the ones which lack them
    url = foundKnown && !mayCompute(template) ? undefined : nextPage(res.headers.get('link'));
  }
  await runAll(tasks);
  reportSkippedDownloads(packageName);
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
