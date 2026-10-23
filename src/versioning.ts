import { get as getVersioning } from 'renovate/dist/modules/versioning/index.js';
import type { VersioningName } from './schema.ts';

/** How the versions of a tool are validated and ordered. */
export interface Versioning {
  /** whether the string is a valid version */
  isValid: (version: string) => boolean;
  /** whether a valid version is a prerelease */
  isPrerelease: (version: string) => boolean;
  /** compares two valid versions, negative when the first is older */
  compare: (a: string, b: string) => number;
}

/**
 * Reads the date of a dated rust nightly version.
 * @param version - the version, like `nightly-2025-11-24`
 * @returns the date as `YYYY-MM-DD`, or `undefined` for any other version
 */
export function nightlyDate(version: string): string | undefined {
  return /^nightly-(\d{4}-\d{2}-\d{2})$/.exec(version)?.[1];
}

/**
 * Wraps a Renovate versioning: a valid version is a single version of it, not a
 * range, a prerelease is a version it doesn't consider stable, and the versions
 * are ordered with its sort.
 * @param name - the name of the Renovate versioning
 */
function renovateVersioning(name: VersioningName): Versioning {
  const api = getVersioning(name);
  return {
    isValid: (version) => api.isVersion(version),
    isPrerelease: (version) => !api.isStable(version),
    compare: (a, b) => api.sortVersions(a, b),
  };
}

/**
 * Creates the check for versions older than the minimum a tool supports, in the
 * versioning of the tool. Without a minimum, or with one which is no valid
 * version of the versioning and can't be compared, nothing is too old. A version
 * which isn't valid can't be compared either and isn't too old.
 * @param versioning - the versioning of the tool
 * @param minVersion - the oldest supported version, if the tool has one
 * @returns whether a valid version is older than the minimum
 */
export function belowMinimum(
  versioning: VersioningName,
  minVersion?: string,
): (version: string) => boolean {
  const { isValid, compare } = versionings[versioning];
  if (minVersion === undefined || !isValid(minVersion)) {
    return () => false;
  }
  return (version) => isValid(version) && compare(version, minVersion) < 0;
}

/** The versioning of each name, Renovate's versioning of the same name. */
export const versionings: Record<VersioningName, Versioning> = {
  docker: renovateVersioning('docker'),
  gradle: renovateVersioning('gradle'),
  loose: renovateVersioning('loose'),
  maven: renovateVersioning('maven'),
  node: renovateVersioning('node'),
  npm: renovateVersioning('npm'),
  nuget: renovateVersioning('nuget'),
  pep440: renovateVersioning('pep440'),
  python: renovateVersioning('python'),
  ruby: renovateVersioning('ruby'),
  'rust-release-channel': renovateVersioning('rust-release-channel'),
  semver: renovateVersioning('semver'),
};
