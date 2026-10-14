import { z } from 'zod';
import { type ComputedFile, computeChecksumTasks, reportSkippedDownloads } from '../download.ts';
import { type Arch, type PreviousFiles, type ToolFiles, runAll, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { belowMinimum, versionings } from '../versioning.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';

/** The releases of swift.org, with the platforms of each. */
const releasesUrl = 'https://www.swift.org/api/v1/install/releases.json';

const Releases = z.array(
  z.object({
    name: z.string(),
    date: z.string().nullish(),
    platforms: z
      .array(z.object({ name: z.string(), archs: z.array(z.string()).default([]) }))
      .default([]),
  }),
);

/**
 * The Ubuntu releases swift publishes archives for, as the containerbase cli
 * installs them: the archive of Ubuntu 22.04 is the `jammy` one, like the jammy
 * prebuilds, which the cli also uses on noble before 5.10.1, the first release
 * with Ubuntu 24.04 archives, and resolute has its own. Other platforms of a
 * release, like Ubuntu 18.04 and 20.04, are ignored.
 */
const ubuntuPlatforms: { name: string; version: string; distro: string }[] = [
  { name: 'Ubuntu 22.04', version: '22.04', distro: 'jammy' },
  { name: 'Ubuntu 24.04', version: '24.04', distro: 'noble' },
  { name: 'Ubuntu 26.04', version: '26.04', distro: 'resolute' },
];

/** The archs of swift.org by containerbase arch, with the suffix of its file names. */
const archs: { arch: Arch; name: string; suffix: string }[] = [
  { arch: 'amd64', name: 'x86_64', suffix: '' },
  { arch: 'arm64', name: 'aarch64', suffix: '-aarch64' },
];

/**
 * The version as it is in the urls of swift.org: releases before 6.4 drop a
 * `.0` patch from their name, like `swift-6.3-RELEASE`, as the containerbase cli
 * does.
 * @param version - the version
 */
function releaseVersion(version: string): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  const short = patch === 0 && (major < 6 || (major === 6 && minor < 4));
  return short ? `${major}.${minor}` : version;
}

/**
 * Lists the archives of a release, the ones the containerbase cli installs, for
 * the platforms the release has. The urls are the ones of the cli.
 * @param version - the version
 * @param platforms - the platforms of the release
 */
function releaseFiles(
  version: string,
  platforms: { name: string; archs: string[] }[],
): ComputedFile[] {
  const shortVersion = releaseVersion(version);
  const release = `swift-${shortVersion}-RELEASE`;
  return ubuntuPlatforms.flatMap(({ name, version: ubuntu, distro }) => {
    const listed = platforms.find((platform) => platform.name === name)?.archs ?? [];
    return archs
      .filter((arch) => listed.includes(arch.name))
      .map(({ arch, suffix }) => {
        const platform = `ubuntu${ubuntu}${suffix}`;
        const file = `${release}-${platform}.tar.gz`;
        return {
          name: file,
          url: `https://download.swift.org/swift-${shortVersion}-release/${platform.replace(/\./g, '')}/${release}/${file}`,
          arch,
          distro,
        };
      });
  });
}

/**
 * Fetches the swift releases from swift.org. Swift only publishes PGP
 * signatures, so the sha256 of the archives is computed by downloading them,
 * newest release first, within the download budget of the tool. Known files are
 * reused by name. Releases older than the minimum version are skipped, so
 * nothing is downloaded for them.
 * @param _packageName - unused, there is only swift
 * @param _known - unused, the list has all releases
 * @param previous - the already known files by version
 * @param _template - unused, the files are listed here
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, the release date is part of the list
 * @param versioning - which versions are valid and prereleases, `docker` by default
 * @param minVersion - the oldest version to read
 */
export async function fetchSwiftReleases(
  _packageName?: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'docker',
  minVersion?: string,
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const isTooOld = belowMinimum(versioning, minVersion);
  const versions: {
    entry: ToolVersion;
    files: ToolFile[];
    platforms: { name: string; archs: string[] }[];
  }[] = [];
  for (const { name, date, platforms } of await getJson(releasesUrl, Releases)) {
    if (!isValid(name) || isTooOld(name)) {
      continue;
    }
    versions.push({
      entry: toolVersion(name, {
        prerelease: isPrerelease(name),
        releaseTimestamp: toTimestamp(date),
      }),
      files: fetchFiles ? [...(previous.get(name) ?? [])] : [],
      platforms,
    });
  }
  // the checksums are computed newest first, so a backfill starts from the top
  versions.sort((a, b) => compare(b.entry.version, a.entry.version));
  const tasks = fetchFiles
    ? versions.flatMap(({ entry, files, platforms }) =>
        computeChecksumTasks('swift', releaseFiles(entry.version, platforms), files),
      )
    : [];
  await runAll(tasks);
  reportSkippedDownloads('swift');
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
