import { compare, explain } from '@renovatebot/pep440';
import { z } from 'zod';
import { getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import { sortVersions, toolVersion } from '../versions.ts';

const PypiPackage = z.object({
  releases: z.record(z.string(), z.array(z.unknown())),
});

/**
 * Normalizes a python package name, eg. `Foo_Bar` to `foo-bar`.
 * @see {@link https://packaging.python.org/en/latest/specifications/name-normalization/}
 * @param name - the package name
 */
function normalizeName(name: string): string {
  return name.replace(/[-_.]+/g, '-').toLowerCase();
}

/**
 * Fetches all releases of a package from pypi, like the containerbase pip
 * resolver. Releases without files are skipped, they can't be installed.
 * Yanked releases are kept, pip installs them when pinned. Versions which are
 * no valid pep440 version are skipped too.
 * @param packageName - the pypi package name
 */
export async function fetchPypiVersions(packageName: string): Promise<ToolVersion[]> {
  const { releases } = await getJson(
    `https://pypi.org/pypi/${normalizeName(packageName)}/json`,
    PypiPackage,
  );
  const versions: ToolVersion[] = [];
  for (const [version, files] of Object.entries(releases)) {
    const parsed = explain(version);
    if (!parsed || !files.length) {
      continue;
    }
    versions.push(toolVersion(version, { prerelease: parsed.is_prerelease }));
  }
  return sortVersions(versions, compare);
}
