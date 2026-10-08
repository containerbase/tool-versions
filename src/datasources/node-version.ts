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

const NodeReleases = z.array(
  z.object({
    version: z.string(),
    // the lts codename, or `false`
    lts: z.union([z.string(), z.boolean()]),
  }),
);

/**
 * Fetches the node releases from nodejs.org, like the containerbase node
 * resolver. The leading `v` is dropped and a release with an lts codename is
 * flagged as lts.
 * @param _packageName - unused, nodejs.org only has node
 */
export async function fetchNodeVersions(_packageName: string): Promise<ToolVersion[]> {
  const releases = await getJson('https://nodejs.org/dist/index.json', NodeReleases);
  const versions: ToolVersion[] = [];
  for (const release of releases) {
    const version = release.version.replace(/^v/, '');
    if (!isSemver(version)) {
      continue;
    }
    versions.push(
      toolVersion(version, {
        prerelease: isSemverPrerelease(version),
        lts: typeof release.lts === 'string',
      }),
    );
  }
  return sortVersions(versions, compareSemver);
}
