import { z } from 'zod';
import { type PreviousFiles, type ToolFiles, checksumTasks, runAll, withFiles } from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { versionings } from '../versioning.ts';
import { sortVersions, toolVersion } from '../versions.ts';

const DartListing = z.object({
  prefixes: z.array(z.string()).default([]),
  nextPageToken: z.string().optional(),
});

/** The folder of the stable releases in the dart archive. */
const releasePrefix = 'channels/stable/release/';

/**
 * Lists the stable dart sdk versions of the dart archive bucket on Google
 * Cloud Storage, like Renovate's `dart-version` datasource does. A release is a
 * folder, so the listing is paged by folders only.
 * @returns the versions, in the order of the listing
 */
async function listVersions(): Promise<string[]> {
  const versions: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getJson(
      `https://storage.googleapis.com/storage/v1/b/dart-archive/o?alt=json&delimiter=/&prefix=${encodeURIComponent(releasePrefix)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      DartListing,
    );
    for (const prefix of page.prefixes) {
      // like `channels/stable/release/3.5.0/`, `latest` is no version
      versions.push(prefix.slice(releasePrefix.length).replace(/\/$/, ''));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return versions;
}

/**
 * Fetches the stable dart sdk releases from the dart archive. The files come
 * from the function template of the tool, which lists the sdk zip of each
 * architecture with the `.sha256sum` next to it. Known files are reused by
 * name. The archive has no release times, so `releaseTimestamp` is left out.
 * @param _packageName - unused, there is only dart
 * @param _known - unused, the listing has all releases
 * @param previous - the already known files by version
 * @param template - lists the files of a version
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, there are no release times
 * @param versioning - which versions are valid and prereleases, `semver` by default
 */
export async function fetchDartVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'semver',
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  for (const version of await listVersions()) {
    if (!isValid(version)) {
      continue;
    }
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    if (fetchFiles && typeof template === 'function') {
      tasks.push(...checksumTasks('dart', template(version), files));
    }
    versions.push({ entry: toolVersion(version, { prerelease: isPrerelease(version) }), files });
  }
  await runAll(tasks);
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
