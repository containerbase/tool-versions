import semver from 'semver';
import type { ToolVersion } from './schema.ts';

/** The flags of a version, only the true ones end up in the output. */
export interface VersionFlags {
  prerelease?: boolean | undefined;
  lts?: boolean | undefined;
}

/**
 * Creates a version entry which only carries the flags that are true.
 * @param version - the version as `install-tool` accepts it
 * @param flags - the prerelease and lts flags
 */
export function toolVersion(version: string, { prerelease, lts }: VersionFlags = {}): ToolVersion {
  return {
    version,
    ...(prerelease && { prerelease }),
    ...(lts && { lts }),
  };
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
