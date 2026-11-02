import { compare, explain, maxSatisfying, validRange } from '@renovatebot/pep440';
import { z } from 'zod';

import { getJson } from '../http.ts';
import { logWarning } from '../log.ts';
import type { ToolVersion } from '../schema.ts';
import {
  type FetchedVersions,
  sortVersions,
  toConstraints,
  toolVersion,
  toTimestamp,
} from '../versions.ts';

const PypiFile = z.object({
  upload_time_iso_8601: z.string().optional(),
  yanked: z.boolean().optional(),
  requires_python: z.string().nullish(),
});
type PypiFile = z.infer<typeof PypiFile>;

const PypiPackage = z.object({
  releases: z.record(z.string(), z.array(PypiFile)),
});

const PypiInfo = z.object({
  info: z.object({ requires_dist: z.array(z.string()).nullish() }),
});

/**
 * Tools whose `latest` is the newest stable release which the latest release
 * of another package requires, by the package name of the tool's source:
 * poetry follows `poetry-plugin-pypi-mirror`, so the plugin works with it.
 */
const latestFrom: Record<string, string> = {
  poetry: 'poetry-plugin-pypi-mirror',
};

/**
 * Finds when a release was published: the earliest upload of its files which
 * are not yanked.
 * @param files - the files of the release
 * @returns the time, or `undefined` without a valid upload time
 */
function releaseTimestamp(files: PypiFile[]): string | undefined {
  return files
    .filter(({ yanked }) => !yanked)
    .map(({ upload_time_iso_8601 }) => toTimestamp(upload_time_iso_8601))
    .filter((time) => time !== undefined)
    .sort()[0];
}

/**
 * Finds the python versions a release supports: the first `requires_python` of
 * its files which are not yanked, the files of a release normally agree.
 * @param files - the files of the release
 * @returns the constraints, or `undefined` without a `requires_python`
 */
function releaseConstraints(files: PypiFile[]): Record<string, string> | undefined {
  return files
    .filter(({ yanked }) => !yanked)
    .map(({ requires_python }) => toConstraints('python', requires_python))
    .find((constraints) => constraints !== undefined);
}

/**
 * Normalizes a python package name, eg. `Foo_Bar` to `foo-bar`.
 * @see {@link https://packaging.python.org/en/latest/specifications/name-normalization/}
 * @param name - the package name
 */
function normalizeName(name: string): string {
  return name.replace(/[-_.]+/g, '-').toLowerCase();
}

/**
 * Finds the version range of a package in the `requires_dist` of a release,
 * like `poetry (>=1.2.1,<3.0.0)` or `poetry<3,>=2`.
 * @param requiresDist - the requirements of the release
 * @param packageName - the normalized name of the required package
 * @returns the range, or `undefined` when the package isn't required with a valid one
 */
function requiredRange(requiresDist: string[], packageName: string): string | undefined {
  for (const requirement of requiresDist) {
    // the name, optional extras, the range with or without parentheses and optional markers
    const match = /^\s*([\w.-]+)\s*(?:\[[^\]]*\])?\s*\(?([^;)]*)\)?/.exec(requirement);
    const range = match?.[2]?.trim();
    if (match?.[1] && normalizeName(match[1]) === packageName && range && validRange(range)) {
      return range;
    }
  }
  return undefined;
}

/**
 * Finds the newest stable, not deprecated release of a tool which the latest
 * release of another package requires. A failed lookup only logs a warning.
 * @param packageName - the normalized pypi name of the tool
 * @param versions - the releases of the tool
 * @param requiredBy - the pypi package which requires the tool
 * @returns the version, or `undefined` when there is none
 */
async function requiredLatest(
  packageName: string,
  versions: ToolVersion[],
  requiredBy: string,
): Promise<string | undefined> {
  try {
    const { info } = await getJson(`https://pypi.org/pypi/${requiredBy}/json`, PypiInfo);
    const range = requiredRange(info.requires_dist ?? [], packageName);
    if (range === undefined) {
      logWarning(`${packageName}: no ${packageName} requirement in the latest ${requiredBy}`);
      return undefined;
    }
    const stable = versions
      .filter(({ prerelease, deprecated }) => !prerelease && !deprecated)
      .map(({ version }) => version);
    const latest = maxSatisfying(stable, range) ?? undefined;
    if (latest === undefined) {
      logWarning(`${packageName}: no stable release satisfies ${range} of ${requiredBy}`);
    }
    return latest;
  } catch (err) {
    logWarning(`${packageName}: no latest from ${requiredBy}: ${String(err)}`);
    return undefined;
  }
}

/**
 * Fetches all releases of a package from pypi, like the containerbase pip
 * resolver. Releases without files are skipped, they can't be installed.
 * Yanked releases are kept, pip installs them when pinned, and are flagged as
 * deprecated when all their files are yanked. Versions which are
 * no valid pep440 version are skipped too. The `requires_python` of a release
 * is its `python` constraint. Tools in `latestFrom` get a `latest` version.
 * @param packageName - the pypi package name
 */
export async function fetchPypiVersions(packageName: string): Promise<FetchedVersions> {
  const name = normalizeName(packageName);
  const { releases } = await getJson(`https://pypi.org/pypi/${name}/json`, PypiPackage);
  const versions: ToolVersion[] = [];
  for (const [version, files] of Object.entries(releases)) {
    const parsed = explain(version);
    if (!parsed || !files.length) {
      continue;
    }
    versions.push(
      toolVersion(version, {
        prerelease: parsed.is_prerelease,
        deprecated: files.every(({ yanked }) => yanked === true),
        releaseTimestamp: releaseTimestamp(files),
        constraints: releaseConstraints(files),
      }),
    );
  }
  const sorted = sortVersions(versions, compare);
  const requiredBy = latestFrom[name];
  return {
    versions: sorted,
    latest: requiredBy ? await requiredLatest(name, sorted, requiredBy) : undefined,
  };
}
