import { type PreviousFiles, type ToolFiles, checksumTasks, runAll, withFiles } from '../files.ts';
import { request } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { belowMinimum, nightlyDate, versionings } from '../versioning.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';
import { fetchGithubReleases } from './github-releases.ts';

/** The list of all release manifests of the rust release channel. */
const manifestsUrl = 'https://static.rust-lang.org/manifests.txt';

/** How many days of nightlies are published. */
const nightlyDays = 90;

/**
 * Whether a nightly is older than the days of nightlies which are published.
 * Other versions never expire.
 * @param version - the version
 * @param now - the current time
 */
export function isExpiredNightly(version: string, now = Date.now()): boolean {
  const date = nightlyDate(version);
  return (
    date !== undefined && date < new Date(now - nightlyDays * 86_400_000).toISOString().slice(0, 10)
  );
}

/**
 * Lists the dates with a nightly in the `manifests.txt` of the release channel,
 * which has a line like `static.rust-lang.org/dist/2025-11-24/channel-rust-nightly.toml`
 * for every manifest. Days without a nightly are not in it.
 * @returns the dates as `YYYY-MM-DD`
 */
async function listNightlyDates(): Promise<string[]> {
  const text = await (await request(manifestsUrl)).text();
  const dates = new Set<string>();
  for (const line of text.split('\n')) {
    const date = /\/(\d{4}-\d{2}-\d{2})\/channel-rust-nightly\.toml$/.exec(line.trim())?.[1];
    if (date) {
      dates.add(date);
    }
  }
  return [...dates];
}

/**
 * Fetches the versions of rust: the stable releases of the GitHub repository
 * and the nightlies of the last 90 days from the rust release channel, as
 * `nightly-YYYY-MM-DD` prereleases released on their date. Nightlies without a
 * published archive and checksum are published without files, so the build
 * leaves them out. The files come from the function template of the tool.
 * Known files are reused by name, so only new nightlies request checksums.
 * @param packageName - the repository of the stable releases, like `rust-lang/rust`
 * @param known - the versions which are already known
 * @param previous - the already known files by version
 * @param template - lists the files of a version
 * @param fetchFiles - whether to fetch the files at all
 * @param hasTimestamp - the versions which already have a release time
 * @param versioning - which versions are valid and prereleases, and how they are sorted
 * @param minVersion - the oldest version to read, older versions are skipped
 */
export async function fetchRustVersions(
  packageName: string,
  known: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  template?: ToolFiles,
  fetchFiles = true,
  hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'rust-release-channel',
  minVersion?: string,
): Promise<ToolVersion[]> {
  const { compare } = versionings[versioning];
  const isTooOld = belowMinimum(versioning, minVersion);
  const stable = await fetchGithubReleases(
    packageName,
    known,
    previous,
    template,
    fetchFiles,
    hasTimestamp,
    versioning,
    minVersion,
  );
  const nightlies: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  for (const date of await listNightlyDates()) {
    const version = `nightly-${date}`;
    if (isExpiredNightly(version) || isTooOld(version)) {
      continue;
    }
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    if (fetchFiles && typeof template === 'function') {
      tasks.push(...checksumTasks('rust', template(version), files));
    }
    nightlies.push({
      entry: toolVersion(version, { prerelease: true, releaseTimestamp: toTimestamp(date) }),
      files,
    });
  }
  await runAll(tasks);
  return sortVersions(
    [...stable, ...nightlies.map(({ entry, files }) => withFiles(entry, files))],
    compare,
  );
}
