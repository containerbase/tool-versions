import { env } from 'node:process';
import { z } from 'zod';
import {
  type FileCandidate,
  type FileTemplate,
  type PreviousFiles,
  checksumTasks,
  parsePrebuildName,
  runAll,
  withFiles,
} from '../files.ts';
import { request } from '../http.ts';
import type { ToolFile, ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toolVersion,
} from '../versions.ts';

const GithubAsset = z.object({
  name: z.string(),
  browser_download_url: z.string(),
});
type GithubAsset = z.infer<typeof GithubAsset>;

const GithubReleases = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
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
 * distro are read from the file name.
 * @param assets - the files of a release
 */
function assetCandidates(assets: GithubAsset[]): FileCandidate[] {
  const urls = new Map(
    assets.map(({ name, browser_download_url }) => [name, browser_download_url]),
  );
  return assets.flatMap(({ name, browser_download_url }) => {
    const checksumUrl = urls.get(`${name}.sha512`);
    return checksumUrl
      ? [
          {
            name,
            url: browser_download_url,
            checksumUrl,
            algorithm: 'sha512' as const,
            ...parsePrebuildName(name),
          },
        ]
      : [];
  });
}

/**
 * Fetches the releases of a GitHub repository. The leading `v` of a tag is
 * dropped, as `install-tool` does. Drafts and tags which are no valid semver
 * version are skipped. A release is a prerelease when GitHub marks it as one or
 * its version has a prerelease part.
 * GitHub lists the newest releases first, so paging stops after the first page
 * with an already known version.
 * The files are the assets with a `<file>.sha512` sibling, or the ones the
 * template lists. Known files are reused by name, only the missing ones are
 * downloaded.
 * @param packageName - the repository, like `helm/helm`
 * @param known - the versions which are already known
 * @param previous - the already known files by version
 * @param template - lists the files of a version, instead of the assets
 */
export async function fetchGithubReleases(
  packageName: string,
  known: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  template?: FileTemplate,
): Promise<ToolVersion[]> {
  const headers = githubHeaders();
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  let url: string | undefined = `https://api.github.com/repos/${packageName}/releases?per_page=100`;
  while (url) {
    const res = await request(url, headers);
    let foundKnown = false;
    for (const release of GithubReleases.parse(await res.json())) {
      const version = release.tag_name.replace(/^v/, '');
      if (release.draft || !isSemver(version)) {
        continue;
      }
      foundKnown ||= known.has(version);
      const entry = toolVersion(version, {
        prerelease: release.prerelease || isSemverPrerelease(version),
      });
      const files = [...(previous.get(version) ?? [])];
      const candidates = template ? template(version) : assetCandidates(release.assets);
      tasks.push(...checksumTasks(packageName, candidates, files));
      versions.push({ entry, files });
    }
    url = foundKnown ? undefined : nextPage(res.headers.get('link'));
  }
  await runAll(tasks);
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compareSemver,
  );
}
