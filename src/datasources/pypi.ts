import { compare, explain } from '@renovatebot/pep440';
import { z } from 'zod';
import { checksum, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion } from '../schema.ts';
import { sortVersions, toolVersion } from '../versions.ts';

const PypiFile = z.object({
  filename: z.string().optional(),
  url: z.string().optional(),
  digests: z.object({ sha256: z.string().optional() }).optional(),
  yanked: z.boolean().optional(),
});
type PypiFile = z.infer<typeof PypiFile>;

const PypiPackage = z.object({
  releases: z.record(z.string(), z.array(PypiFile)),
});

/**
 * Lists the downloadable files of a release. Yanked files and files without a
 * valid sha256 are left out.
 * @param files - the files of the release
 */
function releaseFiles(files: PypiFile[]): ToolFile[] {
  return files.flatMap(({ filename, url, digests, yanked }) => {
    const sum = checksum(digests?.sha256, 'sha256');
    return filename && url && sum && !yanked ? [{ name: filename, url, checksum: sum }] : [];
  });
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
 * no valid pep440 version are skipped too. The files of a release come with
 * their sha256 from the same document.
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
      withFiles(toolVersion(version, { prerelease: parsed.is_prerelease }), releaseFiles(files)),
    );
  }
  return sortVersions(versions, compare);
}
