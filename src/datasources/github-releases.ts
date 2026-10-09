import { env, stdout } from 'node:process';
import { z } from 'zod';
import { request } from '../http.ts';
import type { Checksums, ToolVersion } from '../schema.ts';
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

/** A checksum file to download for a release file. */
interface SidecarDownload {
  /** the release file the checksum belongs to */
  file: string;
  /** where the checksum file is downloaded from */
  url: string;
  /** the checksums of the version it belongs to */
  checksums: Checksums;
}

/** How many checksum files are downloaded at once. */
const concurrency = 8;

/**
 * Finds the release files which have a `<file>.sha512` sibling.
 * @param assets - the files of a release
 * @param checksums - the checksums of the version, filled by the downloads
 */
function sidecarDownloads(assets: GithubAsset[], checksums: Checksums): SidecarDownload[] {
  const urls = new Map(
    assets.map(({ name, browser_download_url }) => [name, browser_download_url]),
  );
  return assets.flatMap(({ name }) => {
    const url = urls.get(`${name}.sha512`);
    return url ? [{ file: name, url, checksums }] : [];
  });
}

/**
 * Downloads a checksum file and stores its digest. A failed download only
 * prints a warning, the next build tries again.
 * @param packageName - the repository, used in the warning
 * @param download - the checksum file to download
 */
async function downloadChecksum(
  packageName: string,
  { file, url, checksums }: SidecarDownload,
): Promise<void> {
  try {
    const res = await request(url);
    const digest = (await res.text()).trim().split(/\s+/)[0]?.toLowerCase();
    if (!digest || !/^[0-9a-f]+$/.test(digest)) {
      throw new Error('no valid sha512 digest');
    }
    checksums[file] = `sha512:${digest}`;
  } catch (err) {
    stdout.write(`::warning::${packageName}: no checksum for ${file}: ${String(err)}\n`);
  }
}

/**
 * Runs the downloads with a fixed number of workers.
 * @param packageName - the repository, used in warnings
 * @param downloads - the checksum files to download
 */
async function downloadChecksums(packageName: string, downloads: SidecarDownload[]): Promise<void> {
  const queue = [...downloads];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await downloadChecksum(packageName, next);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

/**
 * Fetches the releases of a GitHub repository. The leading `v` of a tag is
 * dropped, as `install-tool` does. Drafts and tags which are no valid semver
 * version are skipped. A release is a prerelease when GitHub marks it as one or
 * its version has a prerelease part.
 * GitHub lists the newest releases first, so paging stops after the first page
 * with an already known version.
 * The checksum of a release file comes from its `<file>.sha512` sibling. Known
 * checksums are reused, only the missing ones are downloaded.
 * @param packageName - the repository, like `helm/helm`
 * @param known - the versions which are already known
 * @param previous - the already known checksums by version
 */
export async function fetchGithubReleases(
  packageName: string,
  known: ReadonlySet<string>,
  previous: ReadonlyMap<string, Checksums> = new Map(),
): Promise<ToolVersion[]> {
  const headers = githubHeaders();
  const versions: ToolVersion[] = [];
  const downloads: SidecarDownload[] = [];
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
      const reused = previous.get(version);
      if (reused) {
        entry.checksums = reused;
      } else {
        const checksums: Checksums = {};
        entry.checksums = checksums;
        downloads.push(...sidecarDownloads(release.assets, checksums));
      }
      versions.push(entry);
    }
    url = foundKnown ? undefined : nextPage(res.headers.get('link'));
  }
  await downloadChecksums(packageName, downloads);
  for (const entry of versions) {
    if (entry.checksums && !Object.keys(entry.checksums).length) {
      delete entry.checksums;
    }
  }
  return sortVersions(versions, compareSemver);
}
