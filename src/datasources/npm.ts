import semver from 'semver';
import { z } from 'zod';
import type { PreviousFiles, ToolFiles } from '../files.ts';
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

/** An npm package and which of its versions to take. */
interface PackageRange {
  packageName: string;
  accepts: (version: string) => boolean;
}

/**
 * Tools whose versions span several npm packages, by the package name of the
 * tool's source. Yarn 1 is the `yarn` package, 2 and later are
 * `@yarnpkg/cli-dist`. The published source only names the main package.
 */
const unions: Record<string, PackageRange[]> = {
  '@yarnpkg/cli-dist': [
    { packageName: '@yarnpkg/cli-dist', accepts: (version) => semver.major(version) >= 2 },
    { packageName: 'yarn', accepts: (version) => semver.major(version) === 1 },
  ],
};

/**
 * Fetches the versions of one npm package which are accepted.
 * @param range - the package and the versions to take
 * @param hasTimestamp - the versions which already have a release time
 */
async function fetchPackage(
  { packageName, accepts }: PackageRange,
  hasTimestamp: ReadonlySet<string>,
): Promise<ToolVersion[]> {
  const url = `https://registry.npmjs.org/${packageName.replace('/', '%2f')}`;
  const meta = await getJson(url, NpmPackage, {
    // the abbreviated document, it lists all versions
    accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
  });
  const names = Object.keys(meta.versions).filter(
    (version) => isSemver(version) && accepts(version),
  );
  const times = names.some((version) => !hasTimestamp.has(version))
    ? (await getJson(url, NpmTimes, { accept: 'application/json' })).time
    : undefined;
  return names.map((version) =>
    toolVersion(version, {
      prerelease: isSemverPrerelease(version),
      releaseTimestamp: hasTimestamp.has(version) ? undefined : toTimestamp(times?.[version]),
    }),
  );
}

/**
 * Fetches all versions of a package from the npm registry, like the
 * containerbase npm resolver. Deprecated versions are kept, `install-tool`
 * still installs them. The abbreviated document has no release times, so the
 * full (much larger) document is only fetched when a version has none yet.
 * The versions of tools with several packages (`yarn`) are merged, see `unions`.
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
  _template?: ToolFiles,
  _fetchFiles?: boolean,
  hasTimestamp: ReadonlySet<string> = new Set(),
): Promise<ToolVersion[]> {
  const ranges = unions[packageName] ?? [{ packageName, accepts: () => true }];
  const versions = (
    await Promise.all(ranges.map((range) => fetchPackage(range, hasTimestamp)))
  ).flat();
  return sortVersions(versions, compareSemver);
}
