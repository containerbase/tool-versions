import { stdout } from 'node:process';
import { HttpError, request } from './http.ts';
import type { ToolFile, ToolVersion } from './schema.ts';

/** How many requests run at once. */
const concurrency = 8;

/** The previously published files of each version. */
export type PreviousFiles = ReadonlyMap<string, readonly ToolFile[]>;

/** The checksum algorithms of the checksum files. */
export type Algorithm = 'sha256' | 'sha512';

/** The length of a hex digest by algorithm. */
const digestLengths: Record<Algorithm, number> = { sha256: 64, sha512: 128 };

/** A file whose checksum is read from a checksum file. */
export interface FileCandidate {
  /** the file name */
  name: string;
  /** where the file is downloaded from */
  url: string;
  /** where the checksum file is downloaded from */
  checksumUrl: string;
  /** the algorithm of the checksum file */
  algorithm: Algorithm;
  arch?: ToolFile['arch'];
  distro?: ToolFile['distro'];
}

/** Lists the files of a version, `version` is without a leading `v`. */
export type FileTemplate = (version: string) => FileCandidate[];

/**
 * Runs async tasks with a fixed number of workers.
 * @param tasks - the tasks to run
 */
export async function runAll(tasks: (() => Promise<void>)[]): Promise<void> {
  const queue = [...tasks];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await next();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

/**
 * Downloads a text file. A missing file (404) is no problem and silent, any
 * other failure prints a warning. The next build tries again.
 * @param url - the url to download
 * @param label - names the tool or package in the warning
 * @returns the text, or `undefined` when it can't be downloaded
 */
export async function fetchText(url: string, label: string): Promise<string | undefined> {
  try {
    const res = await request(url);
    return await res.text();
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) {
      stdout.write(`::warning::${label}: no checksum from ${url}: ${String(err)}\n`);
    }
    return undefined;
  }
}

/**
 * Normalizes a hex digest.
 * @param digest - the digest, in any case
 * @param algorithm - the algorithm it must belong to
 * @returns `<algorithm>:<lowercase hex>`, or `undefined` for an invalid digest
 */
export function checksum(digest: string | undefined, algorithm: Algorithm): string | undefined {
  const hex = digest?.toLowerCase();
  return hex && hex.length === digestLengths[algorithm] && /^[0-9a-f]+$/.test(hex)
    ? `${algorithm}:${hex}`
    : undefined;
}

/**
 * Reads the digest of a checksum file, which is its first whitespace separated
 * token like `sha512sum` prints it.
 * @param text - the content of the checksum file
 * @param algorithm - the expected algorithm
 * @returns `<algorithm>:<lowercase hex>`, or `undefined` for an invalid digest
 */
export function parseChecksumFile(text: string, algorithm: Algorithm): string | undefined {
  return checksum(text.trim().split(/\s+/)[0], algorithm);
}

/**
 * Converts a subresource integrity string to a checksum.
 * @param integrity - like `sha512-<base64>`, may list several hashes
 * @returns `sha512:<hex>`, or `undefined` without a valid sha512 hash
 */
export function integrityToChecksum(integrity: string): string | undefined {
  const hash = integrity
    .split(/\s+/)
    .find((part) => part.startsWith('sha512-'))
    ?.slice('sha512-'.length);
  return hash ? checksum(Buffer.from(hash, 'base64').toString('hex'), 'sha512') : undefined;
}

/**
 * Reads the arch and distro of a containerbase prebuild file name, like
 * `python-3.14.8-jammy-x86_64.tar.xz`.
 * @param name - the file name
 * @returns the arch and distro, empty when the name doesn't follow the scheme
 */
export function parsePrebuildName(name: string): Pick<ToolFile, 'arch' | 'distro'> {
  const match = /^[^-]+-\d[^-]*(?:-(?<distro>[^-]+))?-(?<arch>x86_64|aarch64)\.[^-]+$/.exec(name);
  if (!match?.groups) {
    return {};
  }
  return {
    arch: match.groups['arch'] === 'x86_64' ? 'amd64' : 'arm64',
    ...(match.groups['distro'] && { distro: match.groups['distro'] }),
  };
}

/**
 * Adds files to a version, sorted by name. Nothing is added without files.
 * @param entry - the version
 * @param files - its files
 */
export function withFiles(entry: ToolVersion, files: readonly ToolFile[]): ToolVersion {
  return files.length
    ? { ...entry, files: [...files].sort((a, b) => a.name.localeCompare(b.name, 'en')) }
    : entry;
}

/**
 * Creates the tasks which read the checksums of the candidates that are not
 * known yet.
 * @param label - names the tool or package in warnings
 * @param candidates - the files of a version
 * @param files - the known files of the version, the downloads add to it
 */
export function checksumTasks(
  label: string,
  candidates: FileCandidate[],
  files: ToolFile[],
): (() => Promise<void>)[] {
  return candidates
    .filter(({ name }) => !files.some((file) => file.name === name))
    .map(({ name, url, checksumUrl, algorithm, arch, distro }) => async () => {
      const text = await fetchText(checksumUrl, label);
      if (text === undefined) {
        return;
      }
      const sum = parseChecksumFile(text, algorithm);
      if (!sum) {
        stdout.write(`::warning::${label}: no valid ${algorithm} digest in ${checksumUrl}\n`);
        return;
      }
      files.push({ name, url, checksum: sum, ...(arch && { arch }), ...(distro && { distro }) });
    });
}
