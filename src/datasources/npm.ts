import { z } from 'zod';
import type { FileTemplate, PreviousFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toTimestamp,
  toolVersion,
} from '../versions.ts';

const NpmPackage = z.object({
  versions: z.record(z.string(), z.unknown()),
});

const NpmTimes = z.object({
  // the publish time of each version, also has `created` and `modified`
  time: z.record(z.string(), z.string()).optional(),
});

/**
 * Fetches all versions of a package from the npm registry, like the
 * containerbase npm resolver. Deprecated versions are kept, `install-tool`
 * still installs them. The abbreviated document has no release times, so the
 * full (much larger) document is only fetched when a version has none yet.
 * @param packageName - the npm package name
 * @param _known - unused, the registry lists all versions at once
 * @param _previous - unused, npm tools have no files
 * @param _template - unused, npm tools have no files
 * @param _fetchFiles - unused, npm tools have no files
 * @param hasTimestamp - the versions which already have a release time
 */
export async function fetchNpmVersions(
  packageName: string,
  _known?: ReadonlySet<string>,
  _previous?: PreviousFiles,
  _template?: FileTemplate,
  _fetchFiles?: boolean,
  hasTimestamp: ReadonlySet<string> = new Set(),
): Promise<ToolVersion[]> {
  const url = `https://registry.npmjs.org/${packageName.replace('/', '%2f')}`;
  const meta = await getJson(url, NpmPackage, {
    // the abbreviated document, it lists all versions
    accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
  });
  const names = Object.keys(meta.versions).filter(isSemver);
  const times = names.some((version) => !hasTimestamp.has(version))
    ? (await getJson(url, NpmTimes, { accept: 'application/json' })).time
    : undefined;
  const versions = names.map((version) =>
    toolVersion(version, {
      prerelease: isSemverPrerelease(version),
      releaseTimestamp: hasTimestamp.has(version) ? undefined : toTimestamp(times?.[version]),
    }),
  );
  return sortVersions(versions, compareSemver);
}
