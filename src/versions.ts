import { eq as rubyEq, gt as rubyGt, valid as rubyValid } from '@renovatebot/ruby-semver';
import semver from 'semver';
import type { ToolVersion } from './schema.ts';

/**
 * The flags and the release time of a version, only the true flags and a known
 * release time end up in the output.
 */
export interface VersionFlags {
  prerelease?: boolean | undefined;
  lts?: boolean | undefined;
  releaseTimestamp?: string | undefined;
  constraints?: Record<string, string> | undefined;
}

/**
 * Creates a version entry which only carries the flags that are true, and the
 * release time and the constraints when they are known.
 * @param version - the version as `install-tool` accepts it
 * @param flags - the prerelease and lts flags, the release time and the constraints
 */
export function toolVersion(
  version: string,
  { prerelease, lts, releaseTimestamp, constraints }: VersionFlags = {},
): ToolVersion {
  return {
    version,
    ...(prerelease && { prerelease }),
    ...(lts && { lts }),
    ...(releaseTimestamp && { releaseTimestamp }),
    ...(constraints && { constraints }),
  };
}

/**
 * Creates the constraints of a version from the raw constraint of a registry.
 * @param parent - the parent tool the constraint is for, like `node`
 * @param constraint - the raw constraint, anything but a non-empty string is ignored
 * @param anything - the constraints which accept any version and say nothing
 * @returns the constraints, or `undefined` without a useful one
 */
export function toConstraints(
  parent: string,
  constraint: unknown,
  ...anything: string[]
): Record<string, string> | undefined {
  const value = typeof constraint === 'string' ? constraint.trim() : '';
  return value && !anything.includes(value) ? { [parent]: value } : undefined;
}

/**
 * Normalizes a date or time to the `toISOString()` format, in UTC.
 * @param value - an ISO 8601 date or time, a date has no time and means midnight
 * @returns the normalized time, or `undefined` when there is no valid one
 */
export function toTimestamp(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/**
 * Removes duplicate versions, keeping the first entry, and sorts the rest
 * newest first.
 * @param versions - the versions to sort
 * @param compare - compares two versions, negative when the first is older
 */
export function sortVersions(
  versions: ToolVersion[],
  compare: (a: string, b: string) => number,
): ToolVersion[] {
  const unique = new Map<string, ToolVersion>();
  for (const entry of versions) {
    if (!unique.has(entry.version)) {
      unique.set(entry.version, entry);
    }
  }
  return [...unique.values()].sort((a, b) => compare(b.version, a.version));
}

/**
 * Checks if a version is a valid ruby gem version, like `2.5.6` or `2.6.0.rc1`,
 * with the library Renovate's `ruby` versioning uses.
 * @param version - the version to check
 */
export function isRubyVersion(version: string): boolean {
  return rubyValid(version) !== null;
}

/**
 * Compares two ruby gem versions like `Gem::Version`, with the library
 * Renovate's `ruby` versioning uses, so `1.0.0.rc1` is older than `1.0.0`.
 * @param a - the first version
 * @param b - the second version
 */
export function compareRuby(a: string, b: string): number {
  if (rubyEq(a, b)) {
    return 0;
  }
  return rubyGt(a, b) ? 1 : -1;
}

/**
 * Compares two semver versions, including their build metadata, so
 * `17.0.12+7` and `17.0.12+8` have a stable order.
 * @param a - the first version
 * @param b - the second version
 */
export function compareSemver(a: string, b: string): number {
  return semver.compareBuild(a, b);
}

/**
 * Checks if a semver version has a prerelease part, like `1.0.0-rc.1`.
 * @param version - a valid semver version
 */
export function isSemverPrerelease(version: string): boolean {
  return semver.prerelease(version) !== null;
}

/**
 * Checks if a version is a valid semver version.
 * @param version - the version to check
 */
export function isSemver(version: string): boolean {
  return semver.valid(version) !== null;
}

/**
 * A plain semver version, as it is written: `major.minor.patch` without a `v`
 * prefix, spaces, leading zeros or build metadata, with an optional prerelease.
 */
export const plainSemver =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/;

/**
 * Checks if a version is a plain semver version, see {@link plainSemver}, which
 * the semver package accepts too: it rejects parts above the largest safe
 * integer and versions of more than 256 characters.
 * @param version - the version to check
 */
export function isPlainSemver(version: string): boolean {
  return plainSemver.test(version) && semver.valid(version) !== null;
}
