import { z } from 'zod';
import { integrityToChecksum, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toolVersion,
} from '../versions.ts';

const NpmDist = z.object({ tarball: z.string(), integrity: z.string().optional() });
type NpmDist = z.infer<typeof NpmDist>;

const NpmPackage = z.object({
  versions: z.record(z.string(), z.object({ dist: NpmDist.optional() })),
});

/**
 * Reads the tarball of a version as a file, from the url and the integrity of
 * the registry.
 * @param dist - the `dist` entry of the version
 * @returns the file, empty without a tarball and a sha512 integrity
 */
function tarballFiles(dist: NpmDist | undefined): ToolFile[] {
  if (!dist?.integrity) {
    return [];
  }
  const name = dist.tarball.split('/').pop();
  const sum = integrityToChecksum(dist.integrity);
  return name && sum ? [{ name, url: dist.tarball, checksum: sum }] : [];
}

/**
 * Fetches all versions of a package from the npm registry, like the
 * containerbase npm resolver. Deprecated versions are kept, `install-tool`
 * still installs them. The tarball and its checksum come from the same
 * document.
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
  const versions = Object.entries(meta.versions)
    .filter(([version]) => isSemver(version))
    .map(([version, { dist }]) =>
      withFiles(
        toolVersion(version, { prerelease: isSemverPrerelease(version) }),
        tarballFiles(dist),
      ),
    );
  return sortVersions(versions, compareSemver);
}
