import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { formatDir } from './formats.ts';

/** The files of a release archive by their path relative to its root, with their content. */
export type FileMap = ReadonlyMap<string, string>;

/**
 * The `major.minor` of the releases, set by hand: a new major version is for a
 * breaking change of the format or the archive, a new minor version for new
 * features like new fields or files. A change of the data is a patch release.
 */
export const releaseBase = '1.0';

/**
 * Creates the version of the next release: the latest published patch version
 * of the base `major.minor` plus one, or `<major>.<minor>.0` when there is none
 * yet, for the first release and after a bump of the base.
 * @param base - the `major.minor` of the releases, like `1.0`
 * @param published - the published versions or their tags with a leading `v`,
 * in any order
 * @returns the next version
 */
export function nextVersion(base: string, published: readonly string[]): string {
  const prefix = `${base}.`;
  const patches = published.flatMap((tag) => {
    const version = tag.replace(/^v/, '');
    const patch = version.startsWith(prefix) ? version.slice(prefix.length) : '';
    return /^\d+$/.test(patch) ? [Number(patch)] : [];
  });
  return `${prefix}${patches.length ? Math.max(...patches) + 1 : 0}`;
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
 * Other content, like the `$schema`, stays as it is.
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
    return JSON.stringify(rest);
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
  return JSON.stringify({ ...rest, tools });
}

/**
 * Decides whether the data of a new release differs from the previous one,
 * ignoring what changes with every build: the `updatedAt` of the files and the
 * digests which follow from them.
 * @param previous - the files of the previous release
 * @param next - the files of the new release
 * @returns whether the new release has changes
 */
export function hasChanges(previous: FileMap, next: FileMap): boolean {
  const data = (files: FileMap): [string, string][] =>
    [...files]
      .map(([path, content]): [string, string] => [path, normalize(path, content)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(data(previous)) !== JSON.stringify(data(next));
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

/**
 * Selects the client files of the build output: the root `index.json` and its
 * schema, and everything in the folder of the format except the internal
 * `<tool>.full.json` files. Other files, like a job summary, are left out.
 * @param files - the files of the build output
 * @returns the files of the release archive
 */
export function selectFiles(files: FileMap): Map<string, string> {
  return new Map(
    [...files].filter(
      ([path]) =>
        path === 'index.json' ||
        path === 'formats.schema.json' ||
        (path.startsWith(`${formatDir}/`) && !path.endsWith('.full.json')),
    ),
  );
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
