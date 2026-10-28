import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { formatDir } from './formats.ts';
import { parseCommit, sortKeys } from './release-notes.ts';

/** The files of a release archive by their path relative to its root, with their content. */
export type FileMap = ReadonlyMap<string, string>;

/**
 * The major version of the releases, the major version of the data format: it
 * only changes with a new format folder.
 */
export const releaseMajor = Number(formatDir.slice(1));

/** A breaking change which can't be released with the current major version. */
export class BreakingChangeError extends Error {}

/**
 * Plans the version of the next release like `nextVersion`, but a breaking
 * change is returned as an error message instead of being thrown, so a build can
 * go on without a release.
 * @param major - the major version of the releases
 * @param published - the published versions or their tags
 * @param commits - the subjects of the commits since the previous release
 * @returns the version, or an empty version and the message of the error
 */
export function planVersion(
  major: number,
  published: readonly string[],
  commits: readonly string[],
): { version: string; error?: string } {
  try {
    return { version: nextVersion(major, published, commits) };
  } catch (err) {
    if (err instanceof BreakingChangeError) {
      return { version: '', error: err.message };
    }
    throw err;
  }
}

/**
 * The minor and patch of the highest published version of a major version.
 * @param major - the major version of the releases
 * @param published - the published versions or their tags with a leading `v`,
 * in any order, tags of other majors and of no version are ignored
 */
function latestOf(
  major: number,
  published: readonly string[],
): { minor: number; patch: number } | undefined {
  const versions = published.flatMap((tag) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    const [tagMajor, minor, patch] = match?.slice(1).map(Number) ?? [];
    return tagMajor === major && minor !== undefined && patch !== undefined
      ? [{ minor, patch }]
      : [];
  });
  return versions.sort((a, b) => b.minor - a.minor || b.patch - a.patch)[0];
}

/**
 * The highest published version of a major version, like `1.7.21`.
 * @param major - the major version of the releases
 * @param published - the published versions or their tags with a leading `v`
 * @returns the version, `undefined` without a release of the major version
 */
export function latestVersion(major: number, published: readonly string[]): string | undefined {
  const latest = latestOf(major, published);
  return latest && `${major}.${latest.minor}.${latest.patch}`;
}

/**
 * Creates the version of the next release from the commits since the previous
 * one, like semantic-release: a `feat` commit is a minor release, anything else,
 * also only a change of the data, a patch release. The previous release is the
 * highest version of the major version, the first release of a major, also
 * after a new format folder with a breaking change, is `<major>.0.0`.
 * @param major - the major version of the releases
 * @param published - the published versions or their tags with a leading `v`,
 * in any order, tags of other majors and of no version are ignored
 * @param commits - the subjects of the commits since the previous release
 * @returns the next version
 * @throws a `BreakingChangeError` when a commit is a breaking change and there
 * is a release of the major version: it needs a new format folder
 */
export function nextVersion(
  major: number,
  published: readonly string[],
  commits: readonly string[],
): string {
  const parsed = commits.flatMap((subject) => parseCommit(subject) ?? []);
  const latest = latestOf(major, published);
  if (!latest) {
    return `${major}.0.0`;
  }
  const breaking = parsed.find((commit) => commit.breaking);
  if (breaking) {
    throw new BreakingChangeError(
      `A breaking change can't be released as ${major}.x.y: the major version is the data format major and only changes with a new format folder, see the versioning policy in docs/format.md: ${breaking.type}${breaking.scope ? `(${breaking.scope})` : ''}: ${breaking.description}`,
    );
  }
  return parsed.some((commit) => commit.type === 'feat')
    ? `${major}.${latest.minor + 1}.0`
    : `${major}.${latest.minor}.${latest.patch + 1}`;
}

/**
 * Whether a value is an object with string keys.
 * @param value - the value
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Removes what changes with every build without a change of the data from the
 * content of a file: the `updatedAt` and, in the `index.json` of the format,
 * the integrity of the files, which the files themselves are compared for.
 * Other content, like the `$schema`, stays as it is. The keys of the json are
 * sorted, so a file which only has another key order is the same.
 * @param path - the path of the file
 * @param content - the content of the file
 * @returns the normalized content
 */
function normalize(path: string, content: string): string {
  if (!path.endsWith('.json')) {
    return content;
  }
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return content;
  }
  if (!isRecord(data)) {
    return content;
  }
  const { updatedAt: _updatedAt, ...rest } = data;
  if (path !== `${formatDir}/index.json` || !Array.isArray(rest['tools'])) {
    return JSON.stringify(sortKeys(rest));
  }
  const tools = rest['tools'].map((tool: unknown) => {
    if (!isRecord(tool)) {
      return tool;
    }
    const { slim, versionFiles, ...others } = tool;
    return {
      ...others,
      slim: isRecord(slim) ? { file: slim['file'] } : slim,
      ...(versionFiles !== undefined && {
        versionFiles: isRecord(versionFiles) ? { file: versionFiles['file'] } : versionFiles,
      }),
    };
  });
  return JSON.stringify(sortKeys({ ...rest, tools }));
}

/**
 * Decides whether the data of a new release differs from the previous one,
 * ignoring what changes with every build: the `updatedAt` of the files, the
 * digests which follow from them, and the `release.json`.
 * @param previous - the files of the previous release
 * @param next - the files of the new release
 * @returns whether the new release has changes
 */
export function hasChanges(previous: FileMap, next: FileMap): boolean {
  const data = (files: FileMap): [string, string][] =>
    [...files]
      .filter(([path]) => path !== 'release.json')
      .map(([path, content]): [string, string] => [path, normalize(path, content)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(data(previous)) !== JSON.stringify(data(next));
}

/**
 * Decides whether a release is due: there is none yet, or the data differs from
 * the previous release.
 * @param previous - the files of the previous release, none when there isn't one
 * @param next - the files of the new release
 */
export function isReleaseDue(previous: FileMap | undefined, next: FileMap): boolean {
  return previous === undefined || hasChanges(previous, next);
}

/**
 * Decides whether the commits since the previous release warrant a release of
 * their own: a feature, a fix or a breaking change. Other commits and changes of
 * the data only wait for the next scheduled release.
 * @param commits - the subjects of the commits since the previous release
 */
export function hasReleaseCommit(commits: readonly string[]): boolean {
  return commits
    .flatMap((subject) => parseCommit(subject) ?? [])
    .some((commit) => commit.breaking || commit.type === 'feat' || commit.type === 'fix');
}

/**
 * Creates the lines for the `GITHUB_OUTPUT` file of a workflow step: whether a
 * release is due, its version, and whether a breaking change blocks the release,
 * with the message of the error.
 * @param output - the outputs
 * @param output.version - the version of the release, empty for a breaking change
 * @param output.changed - whether a release is due
 * @param output.error - the message of a breaking change
 */
export function githubOutput({
  version,
  changed,
  error,
}: {
  version: string;
  changed: boolean;
  error?: string | undefined;
}): string {
  return [
    `changed=${changed}`,
    `version=${version}`,
    `breaking=${error !== undefined}`,
    `error=${error ?? ''}`,
    '',
  ].join('\n');
}

/**
 * Reads all files of a folder, recursively.
 * @param dir - the folder
 * @returns the files by their path relative to the folder, with `/` separators
 */
export async function readFiles(dir: string): Promise<Map<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries.filter((item) => item.isFile())) {
    const file = join(entry.parentPath, entry.name);
    files.set(file.slice(dir.length + 1).replaceAll('\\', '/'), await readFile(file, 'utf8'));
  }
  return files;
}

/** The client files at the root of the site, next to the folder of the format. */
const rootFiles = new Set([
  'index.json',
  'formats.schema.json',
  'release.json',
  'release.schema.json',
]);

/**
 * Selects the client files of the build output: the root `index.json`, the
 * `release.json` and their schemas, and everything in the folder of the
 * format. Other files, like a job summary, are left out.
 * @param files - the files of the build output
 * @returns the files of the release archive
 */
export function selectFiles(files: FileMap): Map<string, string> {
  return new Map(
    [...files].filter(([path]) => rootFiles.has(path) || path.startsWith(`${formatDir}/`)),
  );
}

/**
 * The build time of the data: the `updatedAt` of the `index.json` of the
 * format, when the build started.
 * @param files - the files of the build output
 * @returns the build time, `undefined` without a valid `index.json`
 */
export function buildTimeOf(files: FileMap): string | undefined {
  const content = files.get(`${formatDir}/index.json`);
  try {
    const data: unknown = content === undefined ? undefined : JSON.parse(content);
    return isRecord(data) && typeof data['updatedAt'] === 'string' ? data['updatedAt'] : undefined;
  } catch {
    return undefined;
  }
}

/** What the release archive is made of, for the job summary. */
export interface ArchiveInfo {
  /** the path of the archive */
  archive: string;
  /** the number of files in it */
  files: number;
  /** the size of the archive in bytes */
  packed: number;
  /** the size of the files in bytes */
  unpacked: number;
}

/**
 * Creates the release archive `tool-versions-<version>.tar.xz` of the client
 * files of a build, with the paths relative to the site root, like `v1/node.json`,
 * and its `.sha512` file, which has the bare lowercase hex digest like the ones
 * of the containerbase prebuilds. Uses `tar` and `xz`.
 * @param from - the build output folder
 * @param to - the folder to write the archive to
 * @param version - the version of the release
 * @returns what the archive is made of
 */
export async function createArchive(
  from: string,
  to: string,
  version: string,
): Promise<ArchiveInfo> {
  const files = selectFiles(await readFiles(from));
  await mkdir(to, { recursive: true });
  const list = join(to, `tool-versions-${version}.list`);
  await writeFile(list, `${[...files.keys()].sort().join('\n')}\n`);
  const archive = join(to, `tool-versions-${version}.tar.xz`);
  try {
    await promisify(execFile)('tar', ['-cJf', archive, '-C', from, '-T', list]);
  } finally {
    await rm(list, { force: true });
  }
  const bytes = await readFile(archive);
  await writeFile(`${archive}.sha512`, createHash('sha512').update(bytes).digest('hex'));
  return {
    archive,
    files: files.size,
    packed: bytes.byteLength,
    unpacked: [...files.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0),
  };
}
