import { env } from 'node:process';
import { z } from 'zod';
import { request } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toolVersion,
} from '../versions.ts';

const GithubReleases = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
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
 * Fetches the releases of a GitHub repository. The leading `v` of a tag is
 * dropped, as `install-tool` does. Drafts and tags which are no valid semver
 * version are skipped. A release is a prerelease when GitHub marks it as one or
 * its version has a prerelease part.
 * GitHub lists the newest releases first, so paging stops after the first page
 * with an already known version.
 * @param packageName - the repository, like `helm/helm`
 * @param known - the versions which are already known
 */
export async function fetchGithubReleases(
  packageName: string,
  known: ReadonlySet<string>,
): Promise<ToolVersion[]> {
  const headers = githubHeaders();
  const versions: ToolVersion[] = [];
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
      versions.push(
        toolVersion(version, {
          prerelease: release.prerelease || isSemverPrerelease(version),
        }),
      );
    }
    url = foundKnown ? undefined : nextPage(res.headers.get('link'));
  }
  return sortVersions(versions, compareSemver);
}
