import { compare, explain } from '@renovatebot/pep440';
import { z } from 'zod';
import { getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';

const PypiFile = z.object({
  upload_time_iso_8601: z.string().optional(),
  yanked: z.boolean().optional(),
});
type PypiFile = z.infer<typeof PypiFile>;

const PypiPackage = z.object({
  releases: z.record(z.string(), z.array(PypiFile)),
});

/**
 * Finds when a release was published: the earliest upload of its files which
 * are not yanked.
 * @param files - the files of the release
 * @returns the time, or `undefined` without a valid upload time
 */
function releaseTimestamp(files: PypiFile[]): string | undefined {
  return files
    .filter(({ yanked }) => !yanked)
    .map(({ upload_time_iso_8601 }) => toTimestamp(upload_time_iso_8601))
    .filter((time) => time !== undefined)
    .sort()[0];
}

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
    versions.push(
      toolVersion(version, {
        prerelease: parsed.is_prerelease,
        releaseTimestamp: releaseTimestamp(files),
      }),
    );
  }
  return sortVersions(versions, compare);
}
