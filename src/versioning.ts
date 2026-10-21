import { compare as comparePep440, explain } from '@renovatebot/pep440';
import type { VersioningName } from './schema.ts';
import {
  compareRuby,
  compareSemver,
  isRubyVersion,
  isSemver,
  isSemverPrerelease,
} from './versions.ts';

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
 * Splits a docker style version into its numeric segments and its optional
 * suffix: `28.5.0.7` is `[28, 5, 0, 7]`, `1.2-rc1` also has the suffix `rc1`.
 * @param version - the version
 * @returns the parts, or `undefined` when the version isn't dot separated numbers with an optional suffix
 */
function parseDocker(version: string): { segments: number[]; suffix: string } | undefined {
  const match = /^(?<numbers>\d+(?:\.\d+)*)(?:-(?<suffix>.+))?$/.exec(version);
  if (!match?.groups) {
    return undefined;
  }
  return {
    segments: (match.groups['numbers'] ?? '').split('.').map(Number),
    suffix: match.groups['suffix'] ?? '',
  };
}

/**
 * Compares two versions like Renovate's `docker` versioning: any number of
 * numeric dot segments (missing ones count as `0`), compared one by one. With
 * equal numbers a version with a `-suffix` is a prerelease and older than one
 * without, and two suffixes are compared as text.
 * @param a - the first version
 * @param b - the second version
 */
export function compareDocker(a: string, b: string): number {
  const left = parseDocker(a);
  const right = parseDocker(b);
  if (!left || !right) {
    throw new Error(`Invalid docker version ${left ? b : a}`);
  }
  for (let i = 0; i < Math.max(left.segments.length, right.segments.length); i++) {
    const diff = (left.segments[i] ?? 0) - (right.segments[i] ?? 0);
    if (diff) {
      return diff;
    }
  }
  if (left.suffix === right.suffix) {
    return 0;
  }
  if (!left.suffix || !right.suffix) {
    return left.suffix ? -1 : 1;
  }
  return left.suffix < right.suffix ? -1 : 1;
}

/**
 * Splits a NuGet version into its numeric parts (one to four), its prerelease
 * identifiers and drops the build metadata: `1.2.3.4-beta.2+abc` is
 * `[1, 2, 3, 4]` and `['beta', '2']`.
 * @param version - the version
 * @returns the parts, or `undefined` when it isn't a NuGet version
 */
function parseNuget(version: string): { numbers: number[]; pre: string[] } | undefined {
  const match =
    /^(?<numbers>\d+(?:\.\d+){0,3})(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );
  if (!match?.groups) {
    return undefined;
  }
  return {
    numbers: (match.groups['numbers'] ?? '').split('.').map(Number),
    pre: match.groups['pre']?.split('.') ?? [],
  };
}

/**
 * Checks if a version is a valid NuGet version: up to four numeric parts, an
 * optional prerelease label and optional build metadata.
 * @param version - the version to check
 */
export function isNugetVersion(version: string): boolean {
  return parseNuget(version) !== undefined;
}

/**
 * Checks if a NuGet version has a prerelease label, like `1.0.0-beta.2`.
 * @param version - a valid NuGet version
 */
export function isNugetPrerelease(version: string): boolean {
  return (parseNuget(version)?.pre.length ?? 0) > 0;
}

/**
 * Compares two NuGet versions: semver, but with up to four numeric parts
 * (missing ones count as `0`). The `docker` compare doesn't fit, as it orders
 * the prerelease labels as text, so `beta.10` would be older than `beta.2`.
 * Prerelease identifiers are compared one by one, numbers numerically and
 * before text, and a version is newer than its prereleases. Build metadata is
 * ignored.
 * @param a - the first version
 * @param b - the second version
 */
export function compareNuget(a: string, b: string): number {
  const left = parseNuget(a);
  const right = parseNuget(b);
  if (!left || !right) {
    throw new Error(`Invalid NuGet version ${left ? b : a}`);
  }
  for (let i = 0; i < 4; i++) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (diff) {
      return diff;
    }
  }
  if (!left.pre.length || !right.pre.length) {
    return left.pre.length ? -1 : right.pre.length ? 1 : 0;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }
    const numeric = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (numeric[0] && numeric[1]) {
      if (Number(x) !== Number(y)) {
        return Number(x) - Number(y);
      }
    } else if (numeric[0] || numeric[1]) {
      return numeric[0] ? -1 : 1;
    } else if (x.toLowerCase() !== y.toLowerCase()) {
      return x.toLowerCase() < y.toLowerCase() ? -1 : 1;
    }
  }
  return 0;
}

/** The rank of the maven qualifiers, a release (no qualifier) is `release`. */
const mavenRanks: Record<string, number> = {
  alpha: 1,
  beta: 2,
  milestone: 3,
  rc: 4,
  cr: 4,
  snapshot: 5,
  '': 6,
  ga: 6,
  final: 6,
  release: 6,
  sp: 7,
};
const mavenRelease = 6;

/** The short qualifiers maven accepts, like `1.0-b2`. */
const mavenAliases: Record<string, string> = { a: 'alpha', b: 'beta', m: 'milestone' };

/**
 * Splits a maven version into numbers and qualifiers at dots, dashes and the
 * switches between digits and letters: `4.0.0-rc-4` is `[4, 0, 0, 'rc', 4]`.
 * @param version - the version
 */
function mavenItems(version: string): (number | string)[] {
  return version
    .toLowerCase()
    .split(/[.-]|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/)
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/.test(part) ? Number(part) : (mavenAliases[part] ?? part)));
}

/**
 * Orders a maven qualifier: the known ones by their rank (`alpha` < `beta` <
 * `milestone` < `rc` < `snapshot` < release < `sp`), unknown ones after `sp`
 * by their text, like Maven's `ComparableVersion`.
 * @param qualifier - the qualifier, empty for a release
 */
function mavenRank(qualifier: string): [number, string] {
  const rank = mavenRanks[qualifier];
  return rank === undefined ? [Object.keys(mavenRanks).length + 1, qualifier] : [rank, ''];
}

/**
 * Compares two maven versions with a small version of Maven's
 * `ComparableVersion`: the items are compared one by one, missing ones count as
 * `0` or as a release, a number is newer than a qualifier and the qualifiers
 * are ordered by {@link mavenRank}. Maven's nested lists for `-` are not
 * modelled, which only matters for exotic versions.
 * @param a - the first version
 * @param b - the second version
 */
export function compareMaven(a: string, b: string): number {
  const left = mavenItems(a);
  const right = mavenItems(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? (typeof right[i] === 'number' ? 0 : '');
    const y = right[i] ?? (typeof left[i] === 'number' ? 0 : '');
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) {
        return x - y;
      }
      continue;
    }
    if (typeof x === 'number' || typeof y === 'number') {
      return typeof x === 'number' ? 1 : -1;
    }
    const [rankX, textX] = mavenRank(x);
    const [rankY, textY] = mavenRank(y);
    if (rankX !== rankY) {
      return rankX - rankY;
    }
    if (textX !== textY) {
      return textX < textY ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Whether a maven version has a prerelease qualifier (`alpha`, `beta`,
 * `milestone`, `rc` or `snapshot`).
 * @param version - a valid maven version
 */
function isMavenPrerelease(version: string): boolean {
  return mavenItems(version).some(
    (item) => typeof item === 'string' && mavenRank(item)[0] < mavenRelease,
  );
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
 * Compares two versions like Renovate's `rust-release-channel` versioning: a
 * dated nightly is newer than any release and nightlies are ordered by date,
 * the releases are semver.
 * @param a - the first version
 * @param b - the second version
 */
function compareRust(a: string, b: string): number {
  const left = nightlyDate(a);
  const right = nightlyDate(b);
  if (left && right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (left || right) {
    return left ? 1 : -1;
  }
  return compareSemver(a, b);
}

/** The semver based versionings, which Renovate also uses for node, npm and python. */
const semverVersioning: Versioning = {
  isValid: isSemver,
  isPrerelease: isSemverPrerelease,
  compare: compareSemver,
};

/** The maven versioning, which gradle uses for its versions too. */
const mavenVersioning: Versioning = {
  isValid: (version) => /^\d/.test(version) && /^[0-9a-z.-]+$/i.test(version),
  isPrerelease: isMavenPrerelease,
  compare: compareMaven,
};

/**
 * Creates the check for versions older than the minimum a tool supports, in the
 * versioning of the tool. Without a minimum, or with one which is no valid
 * version of the versioning and can't be compared, nothing is too old.
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
  return (version) => compare(version, minVersion) < 0;
}

/** The versioning of each name. */
export const versionings: Record<VersioningName, Versioning> = {
  docker: {
    isValid: (version) => parseDocker(version) !== undefined,
    isPrerelease: (version) => Boolean(parseDocker(version)?.suffix),
    compare: compareDocker,
  },
  // gradle versions are numbers with an optional `-rc-1` or `-milestone-1`
  // qualifier, which the maven compare orders like gradle does
  gradle: mavenVersioning,
  maven: mavenVersioning,
  node: semverVersioning,
  npm: semverVersioning,
  nuget: { isValid: isNugetVersion, isPrerelease: isNugetPrerelease, compare: compareNuget },
  pep440: {
    isValid: (version) => explain(version) !== null,
    isPrerelease: (version) => explain(version)?.is_prerelease ?? false,
    compare: comparePep440,
  },
  python: semverVersioning,
  ruby: {
    isValid: isRubyVersion,
    isPrerelease: (version) => /[a-z]/i.test(version),
    compare: compareRuby,
  },
  // the releases are semver, the dated nightlies are prereleases
  'rust-release-channel': {
    isValid: (version) => nightlyDate(version) !== undefined || isSemver(version),
    isPrerelease: (version) => nightlyDate(version) !== undefined || isSemverPrerelease(version),
    compare: compareRust,
  },
  semver: semverVersioning,
};
