import { z } from 'zod';
import { type PreviousFiles, type ToolFiles, checksumTasks, runAll, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { versionings } from '../versioning.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';

const GradleReleases = z.array(
  z.object({
    version: z.string(),
    // like `20241104113227+0000`
    buildTime: z.string().optional(),
    snapshot: z.boolean().default(false),
    nightly: z.boolean().default(false),
    releaseNightly: z.boolean().default(false),
    broken: z.boolean().default(false),
    rcFor: z.string().default(''),
    milestoneFor: z.string().default(''),
  }),
);

/**
 * Converts the build time of a gradle release to an ISO 8601 time.
 * @param buildTime - like `20241104113227+0000`
 * @returns the normalized time, or `undefined` without a valid one
 */
function buildTimestamp(buildTime: string | undefined): string | undefined {
  const match = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)([+-]\d\d)(\d\d)$/.exec(buildTime ?? '');
  return match
    ? toTimestamp(
        `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}:${match[8]}`,
      )
    : undefined;
}

/**
 * Fetches the gradle releases from services.gradle.org, the list the
 * containerbase gradle resolver reads. Snapshots, nightlies and broken
 * releases are skipped, release candidates and milestones are prereleases. The
 * distribution `gradle-<version>-bin.zip` is the file of a version, with the
 * checksum from its `.sha256` file as the containerbase installer reads it.
 * Releases without a `.sha256` file (404) have no file.
 * @param _packageName - unused, there is only gradle
 * @param _known - unused, the list has all releases at once
 * @param previous - the already known files by version
 * @param _template - unused, the distribution is always the same
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, the release time is part of the list
 * @param versioning - which versions are valid and prereleases, `gradle` by default
 */
export async function fetchGradleVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'gradle',
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const releases = await getJson('https://services.gradle.org/versions/all', GradleReleases);
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  for (const release of releases) {
    const { version } = release;
    if (
      release.snapshot ||
      release.nightly ||
      release.releaseNightly ||
      release.broken ||
      !isValid(version)
    ) {
      continue;
    }
    const entry = toolVersion(version, {
      prerelease: isPrerelease(version) || Boolean(release.rcFor || release.milestoneFor),
      releaseTimestamp: buildTimestamp(release.buildTime),
    });
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    if (fetchFiles) {
      const name = `gradle-${version}-bin.zip`;
      const url = `https://services.gradle.org/distributions/${name}`;
      tasks.push(
        ...checksumTasks(
          'gradle',
          [{ name, url, checksumUrls: [`${url}.sha256`], algorithm: 'sha256' }],
          files,
        ),
      );
    }
    versions.push({ entry, files });
  }
  await runAll(tasks);
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
