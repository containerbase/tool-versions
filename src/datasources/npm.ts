import { z } from 'zod';
import { getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toolVersion,
} from '../versions.ts';

const NpmPackage = z.object({
  versions: z.record(z.string(), z.unknown()),
});

/**
 * Fetches all versions of a package from the npm registry, like the
 * containerbase npm resolver. Deprecated versions are kept, `install-tool`
 * still installs them.
 * @param packageName - the npm package name
 */
export async function fetchNpmVersions(packageName: string): Promise<ToolVersion[]> {
  const meta = await getJson(
    `https://registry.npmjs.org/${packageName.replace('/', '%2f')}`,
    NpmPackage,
    {
      // the abbreviated document, it lists all versions
      accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
    },
  );
  const versions = Object.keys(meta.versions)
    .filter(isSemver)
    .map((version) => toolVersion(version, { prerelease: isSemverPrerelease(version) }));
  return sortVersions(versions, compareSemver);
}
