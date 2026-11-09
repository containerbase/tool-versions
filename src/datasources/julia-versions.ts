import { z } from 'zod';

import { type Arch, checksum, type PreviousFiles, type ToolFiles, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { belowMinimum, versionings } from '../versioning.ts';
import { sortVersions, toolVersion } from '../versions.ts';
import { fetchGithubReleases } from './github-releases.ts';

/** The julia releases, with the files and their sha256 of each. */
const versionsUrl = 'https://julialang-s3.julialang.org/bin/versions.json';

const Versions = z.record(
  z.string(),
  z.object({
    files: z
      .array(
        z.object({
          url: z.string(),
          triplet: z.string(),
          sha256: z.string().optional(),
        }),
      )
      .default([]),
  }),
);

/** The triplets of the linux glibc builds, by containerbase arch. */
const triplets: Record<string, Arch> = {
  'x86_64-linux-gnu': 'amd64',
  'aarch64-linux-gnu': 'arm64',
};

/**
 * Fetches the julia releases from the `versions.json` of julialang.org, which
 * lists the files of every release with their sha256, so nothing is
 * downloaded. The files are the linux glibc `.tar.gz` archives, which the
 * containerbase cli installs. Releases older than the minimum version are
 * skipped. The list has no release times, so they are the times of the
 * GitHub releases of `JuliaLang/julia`, which has one for every version since
 * 1.6.0 except 1.8.0-rc2.
 * @param _packageName - unused, there is only julia
 * @param known - the versions which are already known, the GitHub releases
 * are read until the first of them
 * @param _previous - unused, the files come from the list
 * @param _template - unused, the list has the files
 * @param fetchFiles - whether to publish the files at all
 * @param _hasTimestamp - unused, the release times of the known versions are
 * kept by the build
 * @param versioning - which versions are valid and prereleases, `semver` by default
 * @param minVersion - the oldest version to read
 */
export async function fetchJuliaVersions(
  _packageName?: string,
  known: ReadonlySet<string> = new Set(),
  _previous?: PreviousFiles,
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'semver',
  minVersion?: string,
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const isTooOld = belowMinimum(versioning, minVersion);
  const releaseTimestamps = new Map(
    (
      await fetchGithubReleases(
        'JuliaLang/julia',
        known,
        undefined,
        undefined,
        false,
        undefined,
        versioning,
        minVersion,
      )
    ).map(({ version, releaseTimestamp }) => [version, releaseTimestamp]),
  );
  const versions: ToolVersion[] = [];
  for (const [version, { files }] of Object.entries(await getJson(versionsUrl, Versions))) {
    if (!isValid(version) || isTooOld(version)) {
      continue;
    }
    const archives: ToolFile[] = files.flatMap(({ url, triplet, sha256 }) => {
      const arch = triplets[triplet];
      const sum = checksum(sha256, 'sha256');
      if (!arch || !sum || !url.endsWith('.tar.gz')) {
        return [];
      }
      return [{ name: url.slice(url.lastIndexOf('/') + 1), url, checksum: sum, arch }];
    });
    const entry = toolVersion(version, {
      prerelease: isPrerelease(version),
      releaseTimestamp: releaseTimestamps.get(version),
    });
    versions.push(withFiles(entry, fetchFiles ? archives : []));
  }
  return sortVersions(versions, compare);
}
