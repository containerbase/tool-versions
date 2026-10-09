import { mkdir } from 'node:fs/promises';
import { stdout } from 'node:process';
import { type ToolMetadata, tools } from '@containerbase/base';
import { datasources } from './datasources/index.ts';
import { isUnsupportedDistro } from './files.ts';
import { writeIndex, writeSchemas, writeToolVersions } from './output.ts';
import { fetchPrevious } from './previous.ts';
import type {
  PreviousToolVersions,
  Source,
  ToolIndex,
  ToolVersion,
  ToolVersions,
} from './schema.ts';
import { toolFiles, toolLinks, toolSources } from './tools.ts';
import { sortVersions } from './versions.ts';

const metadata: Record<string, ToolMetadata> = tools;

/** The options of a build. */
export interface BuildOptions {
  /** the output folder */
  dir: string;
  /** the tools to build and their sources */
  sources?: Record<string, Source>;
  /** the time to put into the files */
  now?: Date;
  /** fetch every version again, without the previously published files */
  full?: boolean;
}

/**
 * Loads the previously published file of a tool, unless it is a full build.
 * A file of another source is ignored, its versions can't be merged.
 * @param tool - the tool name
 * @param source - the current source of the tool
 * @param full - whether it is a full build
 */
async function loadPrevious(
  tool: string,
  source: Source,
  full: boolean,
): Promise<PreviousToolVersions | undefined> {
  if (full) {
    return undefined;
  }
  const previous = await fetchPrevious(tool);
  return previous?.source.datasource === source.datasource &&
    previous.source.packageName === source.packageName
    ? previous
    : undefined;
}

/**
 * Whether a tool has files. Tools installed by a package manager (`npm`, `pip`
 * or `gem`) have none, the package manager installs and verifies them together
 * with their dependencies.
 * @param tool - the tool name
 */
function hasFiles(tool: string): boolean {
  return !metadata[tool]?.type;
}

/**
 * Sets the `type` of a tool from `@containerbase/base` and its links from the
 * mapping, and removes them when the tool has none, so a previously published
 * file gets the current ones.
 * @param data - the tool versions
 */
function withMetadata(data: ToolVersions): ToolVersions {
  const { tool, type: _type, sourceUrl: _sourceUrl, homepage: _homepage, ...rest } = data;
  const type = metadata[tool]?.type;
  const { sourceUrl, homepage } = toolLinks[tool] ?? {};
  return {
    tool,
    ...(type && { type }),
    ...(sourceUrl && { sourceUrl }),
    ...(homepage && { homepage }),
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
 * Leaves out the versions without files, as they can't be installed. Tools
 * installed by a package manager have no files and keep all versions.
 * @param tool - the tool name
 * @param versions - the versions of the tool
 */
function installable(tool: string, versions: ToolVersion[]): ToolVersion[] {
  return hasFiles(tool) ? versions.filter(({ files }) => files?.length) : versions;
}

/**
 * Fetches the versions of a tool and merges them with the previous ones. The
 * fresh flags win, and versions which disappeared upstream are kept. Previous
 * files and release times are kept for fresh versions without any.
 * @param tool - the tool name
 * @param source - the source of the tool
 * @param previous - the previously published versions
 * @throws when the fetch fails or there are no versions at all
 */
async function fetchVersions(
  tool: string,
  source: Source,
  previous: ToolVersion[],
): Promise<ToolVersion[]> {
  const { fetch, compare } = datasources[source.datasource];
  const known = new Set(previous.map(({ version }) => version));
  const files = new Map(
    previous.flatMap(({ version, files }) => (files ? [[version, files] as const] : [])),
  );
  const timestamps = new Map(
    previous.flatMap(({ version, releaseTimestamp }) =>
      releaseTimestamp ? [[version, releaseTimestamp] as const] : [],
    ),
  );
  const fetched = await fetch(
    source.packageName,
    known,
    files,
    toolFiles[tool],
    hasFiles(tool),
    new Set(timestamps.keys()),
  );
  const fresh = fetched.map((entry) => {
    const keptFiles = files.get(entry.version);
    const keptTimestamp = timestamps.get(entry.version);
    return {
      ...entry,
      ...(!entry.files && keptFiles && { files: keptFiles }),
      ...(!entry.releaseTimestamp && keptTimestamp && { releaseTimestamp: keptTimestamp }),
    };
  });
  const versions = installable(tool, sortVersions([...fresh, ...previous], compare));
  if (!versions.length) {
    throw new Error('No versions found');
  }
  return versions;
}

/**
 * Fetches the versions of every mapped tool and writes the tool files, the
 * index and the json schemas. When a tool fails, its previously published file
 * is written again, with its old `updatedAt`. A tool which fails without a
 * previous file is left out, the other tools are still written.
 * @param options - the build options
 * @returns the tools which failed without a previous file
 * @throws when a mapped tool is unknown to `@containerbase/base`
 */
export async function build({
  dir,
  sources = toolSources,
  now = new Date(),
  full = false,
}: BuildOptions): Promise<string[]> {
  const unknown = Object.keys(sources).filter((tool) => !Object.hasOwn(tools, tool));
  if (unknown.length) {
    throw new Error(`Tools not found in @containerbase/base: ${unknown.join(', ')}`);
  }

  await mkdir(dir, { recursive: true });
  const updatedAt = now.toISOString();
  const index: ToolIndex = { updatedAt, tools: [] };
  const failed: string[] = [];

  for (const [tool, source] of Object.entries(sources)) {
    const loaded = await loadPrevious(tool, source, full);
    const previous = loaded && cleanFiles(loaded);
    let data: ToolVersions;
    try {
      data = {
        tool,
        source,
        updatedAt,
        versions: await fetchVersions(tool, source, previous?.versions ?? []),
      };
      stdout.write(`${tool}: ${data.versions.length} versions\n`);
    } catch (err) {
      if (!previous) {
        failed.push(tool);
        stdout.write(`::error::${tool}: ${String(err)}\n`);
        continue;
      }
      // with the current source, so it gets the current versioning
      data = { ...previous, source, versions: installable(tool, previous.versions) };
      stdout.write(
        `::warning::${tool}: ${String(err)}, keeping the versions from ${previous.updatedAt}\n`,
      );
    }
    const file = await writeToolVersions(dir, withMetadata(data));
    index.tools.push({ tool, file, versionCount: data.versions.length });
  }

  await writeIndex(dir, index);
  await writeSchemas(dir);
  return failed;
}
