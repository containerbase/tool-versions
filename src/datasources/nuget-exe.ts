import { z } from 'zod';
import { computeChecksumTasks, reportSkippedDownloads } from '../download.ts';
import { type PreviousFiles, type ToolFiles, runAll, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { versionings } from '../versioning.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';

const NugetTools = z.object({
  'nuget.exe': z.array(
    z.object({
      version: z.string(),
      stage: z.string().optional(),
      uploaded: z.string().optional(),
    }),
  ),
});

/** The stages of a release which aren't previews. */
const releasedStages = new Set(['Released', 'ReleasedAndBlessed']);

/**
 * Fetches the `nuget.exe` releases from dist.nuget.org, the list the
 * containerbase nuget resolver reads. A release which isn't released (like an
 * early access preview) is a prerelease. The file is `nuget.exe` of the
 * release, which has no published checksum, so it is computed by downloading it
 * once, see `computeChecksumTasks`. The same file works on every architecture.
 * @param _packageName - unused, there is only nuget.exe
 * @param _known - unused, the list has all releases
 * @param previous - the already known files by version
 * @param _template - unused, the file is always `nuget.exe`
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, the upload time is part of the list
 * @param versioning - how the versions are validated and sorted, `nuget` by default
 */
export async function fetchNugetExeVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'nuget',
): Promise<ToolVersion[]> {
  const { isValid, compare } = versionings[versioning];
  const { 'nuget.exe': releases } = await getJson('https://dist.nuget.org/tools.json', NugetTools);
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  // newest first, as the downloads are limited by a budget
  const sorted = releases
    .filter((release) => isValid(release.version))
    .sort((a, b) => compare(b.version, a.version));
  for (const { version, stage, uploaded } of sorted) {
    const entry = toolVersion(version, {
      prerelease: stage !== undefined && !releasedStages.has(stage),
      releaseTimestamp: toTimestamp(uploaded),
    });
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    if (fetchFiles) {
      tasks.push(
        ...computeChecksumTasks(
          'nuget',
          [
            {
              name: 'nuget.exe',
              url: `https://dist.nuget.org/win-x86-commandline/v${version}/nuget.exe`,
            },
          ],
          files,
        ),
      );
    }
    versions.push({ entry, files });
  }
  await runAll(tasks);
  reportSkippedDownloads('nuget');
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
