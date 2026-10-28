import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env, stdout } from 'node:process';
import { type ToolMetadata, tools } from '@containerbase/base';
import { datasources } from './datasources/index.ts';
import { isExpiredNightly } from './datasources/rust-version.ts';
import {
  downloadBudget,
  finishToolDownloads,
  resetDownloadBudget,
  startToolDownloads,
} from './download.ts';
import { isUnsupportedDistro, mayCompute } from './files.ts';
import { formatDir } from './formats.ts';
import { type LogEntry, collectLogs, logError, logNotice, logWarning } from './log.ts';
import {
  fileNameSafe,
  writeFormats,
  writeIndex,
  writeSchemas,
  writeToolVersions,
} from './output.ts';
import { readArchivePrevious } from './previous.ts';
import type {
  PreviousToolVersions,
  Source,
  ToolIndex,
  ToolSource,
  ToolVersion,
  ToolVersions,
} from './schema.ts';
import { BuildReport, type ToolStatus, countNewFiles, writeSummary } from './summary.ts';
import { toolFiles, toolLinks, toolSources } from './tools.ts';
import { belowMinimum, versionings } from './versioning.ts';
import { type FetchedVersions, compareSemver, isPlainSemver, sortVersions } from './versions.ts';

const metadata: Record<string, ToolMetadata> = tools;

/** The options of a build. */
export interface BuildOptions {
  /** the output folder */
  dir: string;
  /** the tools to build and their sources */
  sources?: Record<string, ToolSource>;
  /** the time to put into the files */
  now?: Date;
  /** fetch every version again, without the previous state */
  full?: boolean;
  /** the time in milliseconds, for the duration in the job summary */
  clock?: () => number;
  /**
   * the folder with the extracted archive of the latest release, the previous
   * state to start from. Without one, like for the first release, the build
   * starts empty.
   */
  previousArchive?: string | undefined;
}

/**
 * Loads the previous data of a tool from the archive of the latest release,
 * unless it is a full build. Data of another source is ignored, its versions
 * can't be merged.
 * @param tool - the tool name
 * @param source - the current source of the tool
 * @param full - whether it is a full build
 * @param archive - the folder with the extracted archive of the latest release
 */
async function loadPrevious(
  tool: string,
  source: Source,
  full: boolean,
  archive: string | undefined,
): Promise<PreviousToolVersions | undefined> {
  if (full || !archive) {
    return undefined;
  }
  const previous = await readArchivePrevious(archive, tool);
  return previous?.source.datasource === source.datasource &&
    previous.source.packageName === source.packageName
    ? previous
    : undefined;
}

/**
 * Whether a tool has files. Tools installed by a package manager (a `type` in
 * `@containerbase/base`) have none, the package manager installs and verifies
 * them together with their dependencies.
 * @param tool - the tool name
 */
function hasFiles(tool: string): boolean {
  return !metadata[tool]?.type;
}

/**
 * Sets the `type`, `minVersion` and `distroMinVersion` of a tool from
 * `@containerbase/base`, its links from the mapping, the given `minCb` ranges
 * and the `lts` flag when one of its versions is an LTS release, and removes
 * them when the tool has none, so a previously published file gets the current
 * ones. The `latest` version is dropped when it isn't listed.
 * @param data - the tool versions
 * @param minCb - the published ranges of the tool
 */
function withMetadata(data: ToolVersions, minCb: NonNullable<ToolVersions['minCb']>): ToolVersions {
  const {
    tool,
    type: _type,
    sourceUrl: _sourceUrl,
    homepage: _homepage,
    lts: _lts,
    latest: fetchedLatest,
    minVersion: _minVersion,
    distroMinVersion: _distroMinVersion,
    minCb: _minCb,
    ...rest
  } = data;
  const type = metadata[tool]?.type;
  const { sourceUrl, homepage } = toolLinks[tool] ?? {};
  const lts = data.versions.some((version) => version.lts);
  const latest = data.versions.some(({ version }) => version === fetchedLatest)
    ? fetchedLatest
    : undefined;
  const minVersion = minVersionOf(tool);
  const distroMinVersion = distroMinVersionsOf(tool);
  return {
    tool,
    ...(type && { type }),
    ...(sourceUrl && { sourceUrl }),
    ...(homepage && { homepage }),
    ...(lts && { lts }),
    ...(latest && { latest }),
    ...(minVersion && { minVersion }),
    ...(Object.keys(distroMinVersion).length && { distroMinVersion }),
    ...(minCb.length && { minCb }),
    ...rest,
  };
}

/**
 * Cleans the files of a previously published file. A tool without files loses
 * them all, other tools lose the files of unsupported distros.
 * @param data - the previously published tool versions
 */
function cleanFiles(data: PreviousToolVersions): PreviousToolVersions {
  const files = hasFiles(data.tool);
  return {
    ...data,
    versions: data.versions.map(({ files: old, ...version }) => {
      const kept = files ? old?.filter(({ distro }) => !isUnsupportedDistro(distro)) : undefined;
      return kept?.length ? { ...version, files: kept } : version;
    }),
  };
}

/**
 * Leaves out the versions which can't be installed on `amd64`, where most
 * users and the Mend hosted Renovate run: versions without an `amd64` file or
 * a file for any architecture. Tools installed by a package manager have no
 * files and keep all versions.
 * @param tool - the tool name
 * @param versions - the versions of the tool
 */
function installable(tool: string, versions: ToolVersion[]): ToolVersion[] {
  return hasFiles(tool)
    ? versions.filter(({ files }) => files?.some(({ arch }) => !arch || arch === 'amd64'))
    : versions;
}

/**
 * The oldest version containerbase supports for a tool, on the default distro
 * of `@containerbase/base`. Versions below it aren't published.
 * @param tool - the tool name
 */
function minVersionOf(tool: string): string | undefined {
  return metadata[tool]?.minVersion;
}

/**
 * The oldest version containerbase supports on a distro, by codename, for the
 * distros whose floor differs from the minimum version.
 * @param tool - the tool name
 */
function distroMinVersionsOf(tool: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata[tool]?.distroMinVersion ?? {}).flatMap(([distro, version]) =>
      version === undefined ? [] : [[distro, version] as const],
    ),
  );
}

/**
 * Leaves out the files of a distro for the versions older than the minimum
 * version on that distro. A version left without any file stays as it is, the
 * installable rules decide about it.
 * @param tool - the tool name
 * @param source - the source of the tool
 * @param versions - the versions of the tool
 */
function withoutBelowDistroMinimum(
  tool: string,
  source: Source,
  versions: ToolVersion[],
): ToolVersion[] {
  const floors = Object.entries(distroMinVersionsOf(tool)).map(
    ([distro, min]) => [distro, belowMinimum(source.versioning, min)] as const,
  );
  if (!floors.length) {
    return versions;
  }
  return versions.map(({ files, ...entry }) => {
    const kept = files?.filter(
      ({ distro }) =>
        !floors.some(([name, isTooOld]) => name === distro && isTooOld(entry.version)),
    );
    return kept?.length ? { ...entry, files: kept } : entry;
  });
}

/**
 * Checks the `minCb` ranges of a tool: every `from` must be a valid version in
 * the versioning of the tool and every `cb` a plain semver version. No `from`
 * may be listed twice, and with a growing `from` the `cb` must not go down.
 * @param tool - the tool name
 * @param source - the source of the tool
 * @throws when a range is invalid
 */
export function assertMinCb(tool: string, { versioning, minCb = [] }: ToolSource): void {
  const { isValid, compare } = versionings[versioning];
  for (const { from, cb } of minCb) {
    if (!isValid(from)) {
      throw new Error(`${tool}: minCb from ${from} is not a valid ${versioning} version`);
    }
    if (!isPlainSemver(cb)) {
      throw new Error(`${tool}: minCb ${cb} is not a valid semver version`);
    }
  }
  const ranges = [...minCb].sort((a, b) => compare(a.from, b.from));
  for (const [i, { from, cb }] of ranges.entries()) {
    const previous = ranges[i - 1];
    if (!previous) {
      continue;
    }
    if (compare(previous.from, from) === 0) {
      throw new Error(`${tool}: minCb from ${from} is listed more than once`);
    }
    if (compareSemver(previous.cb, cb) > 0) {
      throw new Error(
        `${tool}: minCb ${cb} from ${from} is older than ${previous.cb} from ${previous.from}`,
      );
    }
  }
}

/**
 * Resolves the configured `minCb` ranges to the published versions: each range
 * starts at the oldest published version which is at least its `from` in the
 * versioning of the tool, prereleases included: the last listed one, which is
 * the lowest listed of versions which compare equal. A range without such a
 * version yet is left out. Two ranges which start at the same version leave the
 * one with the higher `from`, which has the higher `cb` as {@link assertMinCb}
 * checks.
 * @param source - the source of the tool
 * @param versions - the published versions, newest first
 * @returns the ranges, newest version first
 */
function resolveMinCb(
  { versioning, minCb = [] }: ToolSource,
  versions: ToolVersion[],
): NonNullable<ToolVersions['minCb']> {
  const { compare } = versionings[versioning];
  const resolved = new Map<string, string>();
  for (const { from, cb } of [...minCb].sort((a, b) => compare(a.from, b.from))) {
    const oldest = versions.findLast(({ version }) => compare(version, from) >= 0);
    if (oldest) {
      resolved.set(oldest.version, cb);
    }
  }
  return versions.flatMap(({ version }) => {
    const cb = resolved.get(version);
    return cb === undefined ? [] : [{ version, cb }];
  });
}

/**
 * The `minCb` ranges to publish for the versions of a tool. Without configured
 * ranges there are none. When a version is no valid version of the versioning
 * of the tool, the versions can't be compared: the previously published ranges
 * are kept for the versions which are still listed, with a warning.
 * @param tool - the tool name
 * @param source - the source of the tool
 * @param versions - the published versions, newest first
 * @param previous - the previously published ranges
 */
function minCbRanges(
  tool: string,
  source: ToolSource,
  versions: ToolVersion[],
  previous: ToolVersions['minCb'] = [],
): NonNullable<ToolVersions['minCb']> {
  if (!source.minCb?.length) {
    return [];
  }
  const { isValid } = versionings[source.versioning];
  if (versions.every(({ version }) => isValid(version))) {
    return resolveMinCb(source, versions);
  }
  logWarning(
    `${tool}: not every version is a valid ${source.versioning} version, keeping the previous minCb ranges`,
  );
  const listed = new Set(versions.map(({ version }) => version));
  return previous.filter(({ version }) => listed.has(version));
}

/**
 * Leaves out the versions older than the minimum version of the tool, in the
 * versioning of its source, the files of a distro for versions older than its
 * minimum, and the versions which can't be installed.
 * @param tool - the tool name
 * @param source - the source of the tool
 * @param versions - the versions of the tool
 */
function publishable(tool: string, source: Source, versions: ToolVersion[]): ToolVersion[] {
  const isTooOld = belowMinimum(source.versioning, minVersionOf(tool));
  return installable(
    tool,
    withoutBelowDistroMinimum(
      tool,
      source,
      versions.filter(({ version }) => !isTooOld(version)),
    ),
  );
}

/**
 * How old a new version must be before it is published: a registry can list a
 * release before all its downloads are reachable.
 */
const minimumReleaseAge = 60 * 60 * 1000;

/**
 * Fetches the versions of a tool and merges them with the previous ones. The
 * fresh flags win, and versions which disappeared upstream are kept. Previous
 * files and release times are kept for fresh versions without any. The
 * previous constraints always win, as a published release doesn't change: only
 * versions without previous constraints take the fresh ones. New versions
 * younger than the minimum release age wait for a later build, versions
 * without a release time are published right away.
 * @param tool - the tool name
 * @param source - the source of the tool
 * @param published - the previously published versions, without the rust
 * nightlies which are older than the published days
 * @param now - the time of the build, for the minimum release age
 * @returns the versions, and the version of the `latest` tag for sources which have one
 * @throws when the fetch fails or there are no versions at all
 */
async function fetchVersions(
  tool: string,
  source: ToolSource,
  published: ToolVersion[],
  now: Date,
): Promise<FetchedVersions> {
  const previous =
    source.datasource === 'rust-version'
      ? published.filter(({ version }) => !isExpiredNightly(version))
      : published;
  const fetch = datasources[source.datasource];
  const { compare } = versionings[source.versioning];
  const known = new Set(previous.map(({ version }) => version));
  const files = new Map(
    previous.flatMap(({ version, files }) => (files ? [[version, files] as const] : [])),
  );
  const timestamps = new Map(
    previous.flatMap(({ version, releaseTimestamp }) =>
      releaseTimestamp ? [[version, releaseTimestamp] as const] : [],
    ),
  );
  const constraints = new Map(
    previous.flatMap(({ version, constraints }) =>
      constraints ? [[version, constraints] as const] : [],
    ),
  );
  const result = await fetch(
    source.packageName,
    known,
    files,
    toolFiles[tool],
    hasFiles(tool),
    new Set(timestamps.keys()),
    source.versioning,
    minVersionOf(tool),
  );
  const { versions: all, latest } = Array.isArray(result) ? { versions: result } : result;
  const tooNew = all.filter(
    ({ version, releaseTimestamp }) =>
      !known.has(version) &&
      releaseTimestamp !== undefined &&
      now.getTime() - Date.parse(releaseTimestamp) < minimumReleaseAge,
  );
  if (tooNew.length) {
    logNotice(
      `${tool}: ${tooNew.map(({ version }) => version).join(', ')} wait for the minimum release age of 1 hour`,
    );
  }
  const fetched = all.filter((entry) => !tooNew.includes(entry));
  const fresh = fetched.map((entry) => {
    const keptFiles = files.get(entry.version);
    const keptTimestamp = timestamps.get(entry.version);
    const keptConstraints = constraints.get(entry.version);
    return {
      ...entry,
      ...(keptConstraints && { constraints: keptConstraints }),
      ...(!entry.files && keptFiles && { files: keptFiles }),
      ...(!entry.releaseTimestamp && keptTimestamp && { releaseTimestamp: keptTimestamp }),
    };
  });
  const versions = fileNameSafe(
    tool,
    publishable(tool, source, sortVersions([...fresh, ...previous], compare)),
  );
  if (!versions.length) {
    throw new Error('No versions found');
  }
  return { versions, latest };
}

/**
 * Whether the files of a tool may have their checksum computed by downloading
 * them, which counts for its share of the download budget.
 * @param tool - the tool name
 * @param source - the source of the tool
 */
function computesChecksums(tool: string, source: Source): boolean {
  // the nuget.exe and swift datasources compute the checksum of every release
  return (
    mayCompute(toolFiles[tool]) ||
    source.datasource === 'nuget-exe' ||
    source.datasource === 'swift-releases'
  );
}

/**
 * Fetches the versions of every mapped tool and writes the tool files, the
 * index and the json schemas. When a tool fails, its previously published file
 * is written again, with its old `updatedAt`. A tool which fails without a
 * previous file is left out, the other tools are still written.
 * @param options - the build options
 * @returns the tools which failed without a previous file
 * @throws when a mapped tool is unknown to `@containerbase/base`, or has an invalid `minCb`
 */
export async function build({
  dir,
  sources = toolSources,
  now = new Date(),
  full = false,
  clock = () => performance.now(),
  previousArchive,
}: BuildOptions): Promise<string[]> {
  const unknown = Object.keys(sources).filter((tool) => !Object.hasOwn(tools, tool));
  if (unknown.length) {
    throw new Error(`Tools not found in @containerbase/base: ${unknown.join(', ')}`);
  }

  for (const [tool, source] of Object.entries(sources)) {
    assertMinCb(tool, source);
    const minVersion = minVersionOf(tool);
    if (minVersion !== undefined && !versionings[source.versioning].isValid(minVersion)) {
      logWarning(
        `${tool}: the minimum version ${minVersion} is not a valid ${source.versioning} version, no versions are left out`,
      );
    }
  }

  if (!full) {
    stdout.write(
      previousArchive
        ? `previous state: the release archive in ${previousArchive}\n`
        : 'previous state: none, there is no release archive\n',
    );
  }

  // the budget of downloads for computed checksums is split between the tools
  // which may compute files
  resetDownloadBudget(
    Object.entries(sources).filter(([tool, source]) => computesChecksums(tool, source)).length,
  );
  const formatFolder = join(dir, formatDir);
  await mkdir(formatFolder, { recursive: true });
  const updatedAt = now.toISOString();
  const index: ToolIndex = { updatedAt, tools: [] };
  const failed: string[] = [];
  const report = new BuildReport(full, downloadBudget(), clock());

  for (const [tool, source] of Object.entries(sources)) {
    const loaded = await loadPrevious(tool, source, full, previousArchive);
    const previous = loaded && cleanFiles(loaded);
    const logs: LogEntry[] = [];
    let data: ToolVersions | undefined;
    let status: ToolStatus = 'updated';
    let minCb: NonNullable<ToolVersions['minCb']> = [];
    startToolDownloads(computesChecksums(tool, source));
    collectLogs(logs);
    try {
      const fetched = await fetchVersions(tool, source, previous?.versions ?? [], now);
      const { versions } = fetched;
      // a `latest` which still waits for the minimum release age keeps the previous one
      const latest = versions.some(({ version }) => version === fetched.latest)
        ? fetched.latest
        : previous?.latest;
      data = { tool, source, updatedAt, ...(latest && { latest }), versions };
      minCb = minCbRanges(tool, source, data.versions, previous?.minCb);
      stdout.write(`${tool}: ${data.versions.length} versions\n`);
    } catch (err) {
      if (previous) {
        const kept = fileNameSafe(tool, publishable(tool, source, previous.versions));
        const { isValid, compare } = versionings[source.versioning];
        // sorted with the current versioning, the minCb ranges rely on the
        // order, after the versions which are not safe in a file name are gone.
        // Versions which are no valid version of it can't be sorted.
        const versions = kept.every(({ version }) => isValid(version))
          ? sortVersions(kept, compare)
          : kept;
        minCb = minCbRanges(tool, source, versions, previous.minCb);
        // with the current source, so it gets the current versioning
        data = { ...previous, source, versions };
        status = 'kept previous';
        logWarning(`${tool}: ${String(err)}, keeping the versions from ${previous.updatedAt}`);
      } else {
        status = 'failed';
        failed.push(tool);
        logError(`${tool}: ${String(err)}`);
      }
    } finally {
      collectLogs(undefined);
    }
    const downloads = finishToolDownloads();
    report.add({
      tool,
      status,
      versions: data?.versions.length ?? 0,
      newVersions: data
        ? countNew(
            data.versions.map(({ version }) => version),
            previous?.versions,
          )
        : 0,
      filesAdded: data ? countNewFiles(data.versions, previous?.versions ?? []) : 0,
      computedFiles: downloads.files,
      computedBytes: downloads.bytes,
      waitingFiles: downloads.skipped,
      logs: logs.filter(({ level }) => level !== 'notice'),
    });
    if (!data) {
      continue;
    }
    const files = await writeToolVersions(formatFolder, withMetadata(data, minCb));
    index.tools.push({ tool, versionCount: data.versions.length, ...files });
  }

  await writeIndex(formatFolder, index);
  await writeSchemas(formatFolder);
  await writeFormats(dir);
  const summaryFile = env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) {
    await writeSummary(summaryFile, report.render(clock()));
  }
  return failed;
}

/**
 * Counts the versions which weren't in the previous file.
 * @param versions - the published versions
 * @param previous - the versions of the previous file, if there is one
 */
function countNew(versions: string[], previous: ToolVersion[] | undefined): number {
  const known = new Set(previous?.map(({ version }) => version));
  return versions.filter((version) => !known.has(version)).length;
}
