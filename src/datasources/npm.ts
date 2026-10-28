import semver from 'semver';
import { z } from 'zod';
import type { PreviousFiles, ToolFiles } from '../files.ts';
import { getJson } from '../http.ts';
import {
  type FetchedVersions,
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toConstraints,
  toTimestamp,
  toolVersion,
} from '../versions.ts';

const NpmVersion = z.object({
  // only `engines.node`, not `devEngines`, which isn't checked on install.
  // Old packages have odd `engines`, like a list, which count as none.
  engines: z.object({ node: z.unknown() }).optional().catch(undefined),
  // the deprecation message, an empty one undoes the deprecation
  deprecated: z.string().optional().catch(undefined),
});

const NpmPackage = z.object({
  'dist-tags': z.object({ latest: z.string().optional() }).optional().catch(undefined),
  versions: z.record(z.string(), NpmVersion.catch({})),
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
 * Fetches the versions of one npm package which are accepted, and its `latest`
 * dist-tag when that version is accepted.
 * @param range - the package and the versions to take
 * @param hasTimestamp - the versions which already have a release time
 */
async function fetchPackage(
  { packageName, accepts }: PackageRange,
  hasTimestamp: ReadonlySet<string>,
): Promise<FetchedVersions> {
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
  const latest = meta['dist-tags']?.latest;
  return {
    versions: names.map((version) =>
      toolVersion(version, {
        prerelease: isSemverPrerelease(version),
        deprecated: Boolean(meta.versions[version]?.deprecated),
        releaseTimestamp: hasTimestamp.has(version) ? undefined : toTimestamp(times?.[version]),
        constraints: toConstraints('node', meta.versions[version]?.engines?.node, '*'),
      }),
    ),
    latest: latest !== undefined && names.includes(latest) ? latest : undefined,
  };
}

/**
 * Fetches all versions of a package from the npm registry, like the
 * containerbase npm resolver, and the version of its `latest` dist-tag.
 * Deprecated versions are kept and flagged, `install-tool` still installs
 * them. The abbreviated document has no release times, so the
 * full (much larger) document is only fetched when a version has none yet.
 * The `engines.node` of a version, which the abbreviated document has, is its
 * `node` constraint. The versions of tools with several packages (`yarn`) are
 * merged, see `unions`, and their `latest` is the one of the first package.
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
): Promise<FetchedVersions> {
  const ranges = unions[packageName] ?? [{ packageName, accepts: () => true }];
  const packages = await Promise.all(ranges.map((range) => fetchPackage(range, hasTimestamp)));
  return {
    versions: sortVersions(
      packages.flatMap(({ versions }) => versions),
      compareSemver,
    ),
    latest: packages[0]?.latest,
  };
}
