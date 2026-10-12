import { z } from 'zod';
import { getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import { compareNuget, isNugetPrerelease, isNugetVersion } from '../versioning.ts';
import { sortVersions, toolVersion } from '../versions.ts';

const NugetVersions = z.object({
  versions: z.array(z.string()),
});

/**
 * Fetches all versions of a package from nuget.org, like the containerbase
 * nuget resolver. The versions come from the flat container, which is a single
 * request. It has no release times: the registration documents have them, but
 * list the versions of a big package in many pages, one request each, so
 * `releaseTimestamp` is left out. Unlisted versions are not part of the list.
 * @param packageName - the package id, in any case
 */
export async function fetchNugetVersions(packageName: string): Promise<ToolVersion[]> {
  const { versions } = await getJson(
    `https://api.nuget.org/v3-flatcontainer/${packageName.toLowerCase()}/index.json`,
    NugetVersions,
  );
  return sortVersions(
    versions
      .filter(isNugetVersion)
      .map((version) => toolVersion(version, { prerelease: isNugetPrerelease(version) })),
    compareNuget,
  );
}
