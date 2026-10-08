import { z } from 'zod';
import { HttpError, getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toolVersion,
} from '../versions.ts';

const baseUrl = 'https://api.adoptium.net/v3/info';

/** The largest page size the adoptium api accepts. */
const pageSize = 50;

/** The adoptium image type of the supported package names. */
const imageTypes: Record<string, string> = {
  'java-jdk': 'jdk',
  'java-jre': 'jre',
};

const AvailableReleases = z.object({
  available_lts_releases: z.array(z.number()),
});

const ReleaseVersions = z.object({
  versions: z.array(
    z.object({
      major: z.number(),
      semver: z.string(),
    }),
  ),
});
type ReleaseVersions = z.infer<typeof ReleaseVersions>;

/**
 * Fetches one page of the adoptium ga releases.
 * @param imageType - the adoptium image type, `jdk` or `jre`
 * @param page - the zero based page number
 * @returns the releases, empty when the page is past the last one
 */
async function fetchPage(imageType: string, page: number): Promise<ReleaseVersions['versions']> {
  try {
    const { versions } = await getJson(
      `${baseUrl}/release_versions?architecture=x64&heap_size=normal&image_type=${imageType}&os=linux&page=${page}&page_size=${pageSize}&project=jdk&release_type=ga&sort_order=DESC`,
      ReleaseVersions,
    );
    return versions;
  } catch (err) {
    // adoptium answers 404 when no release is left
    if (page > 0 && err instanceof HttpError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

/**
 * Fetches the adoptium ga releases for linux x64, with the same filters as the
 * containerbase java resolver. The version is the adoptium semver, like
 * `25.0.2+10.0.LTS`, which `install-tool` installs. Releases of an lts major
 * are flagged as lts.
 * The releases are requested newest first, so paging stops after the first
 * page with an already known version.
 * @param packageName - `java-jdk` or `java-jre`
 * @param known - the versions which are already known
 * @throws for an unknown package name
 */
export async function fetchJavaVersions(
  packageName: string,
  known: ReadonlySet<string>,
): Promise<ToolVersion[]> {
  const imageType = imageTypes[packageName];
  if (!imageType) {
    throw new Error(`Unknown java package ${packageName}`);
  }

  const { available_lts_releases } = await getJson(
    `${baseUrl}/available_releases`,
    AvailableReleases,
  );
  const ltsMajors = new Set(available_lts_releases);

  const versions: ToolVersion[] = [];
  for (let page = 0; ; page++) {
    const releases = await fetchPage(imageType, page);
    let foundKnown = false;
    for (const { major, semver } of releases) {
      if (!isSemver(semver)) {
        continue;
      }
      foundKnown ||= known.has(semver);
      versions.push(
        toolVersion(semver, {
          prerelease: isSemverPrerelease(semver),
          lts: ltsMajors.has(major),
        }),
      );
    }
    if (foundKnown || releases.length < pageSize) {
      break;
    }
  }
  return sortVersions(versions, compareSemver);
}
