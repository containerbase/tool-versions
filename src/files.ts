import { stdout } from 'node:process';
import { HttpError, request } from './http.ts';
import type { ToolFile, ToolVersion } from './schema.ts';

/** How many requests run at once. */
const concurrency = 8;

/** The previously published files of each version. */
export type PreviousFiles = ReadonlyMap<string, readonly ToolFile[]>;

/** The checksum algorithms of the checksum files. */
export type Algorithm = 'sha1' | 'sha256' | 'sha512';

/** The length of a hex digest by algorithm. */
const digestLengths: Record<Algorithm, number> = { sha1: 40, sha256: 64, sha512: 128 };

/** A file whose checksum is read from a checksum file. */
export interface FileCandidate {
  /** the file name */
  name: string;
  /** where the file is downloaded from */
  url: string;
  /** where the checksum file is downloaded from, the first one that exists is used */
  checksumUrls: string[];
  /** the algorithm of the checksum file */
  algorithm: Algorithm;
  arch?: ToolFile['arch'];
  distro?: ToolFile['distro'];
}

/** Lists the files of a version, `version` is without a leading `v`. */
export type FileTemplate = (version: string) => FileCandidate[];

/** The containerbase arch of a file. */
export type Arch = NonNullable<ToolFile['arch']>;

/** A release asset which is a file to install. */
export interface AssetFile {
  /** the name of the asset */
  name: string;
  /** the arch, omitted for files which work on every architecture */
  arch?: Arch;
}

/**
 * The files of a GitHub release which are its own assets, with the checksums
 * from checksum assets of the same release. A file whose asset or checksum
 * isn't there is skipped.
 */
export interface AssetTemplate {
  /** the asset names of a version, `version` is without the tag prefix and `v` */
  files: (version: string) => AssetFile[];
  /**
   * Where the checksum is: `sidecar` assets named `<file><suffix>`, the first
   * one which exists is used, or a `list` asset with the checksums of many files.
   */
  checksum: { sidecar: string[] } | { list: (version: string) => string };
  /** the algorithm of the checksums, `sha256` by default */
  algorithm?: Algorithm;
  /** the tag part before the version, for tags which aren't `v<version>` or `<version>` */
  tagPrefix?: string;
}

/** How the files of a version are listed, by template function or release assets. */
export type ToolFiles = FileTemplate | AssetTemplate;

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
    const bytes = new Uint8Array(await res.arrayBuffer());
    // powershell publishes its checksums as UTF-16LE with a byte order mark
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
    return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes);
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
 * Reads a checksum list, lines of `<hex>  <name>`, `<hex> *<name>` or
 * `<hex>  ./<name>` like `sha256sum` prints them. Other lines, like the
 * signature of a clearsigned list, are ignored.
 * @param text - the content of the list
 * @param algorithm - the expected algorithm
 * @returns the checksums by file name
 */
export function parseChecksumList(text: string, algorithm: Algorithm): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([0-9a-fA-F]+)\s+\*?(?:\.\/)?(\S.*?)\s*$/.exec(line);
    const sum = checksum(match?.[1], algorithm);
    if (match?.[2] && sum) {
      sums.set(match[2], sum);
    }
  }
  return sums;
}

/**
 * Reads the arch and distro of a containerbase prebuild file name, like
 * `python-3.14.8-jammy-x86_64.tar.xz`.
 * @param name - the file name
 * @returns the arch and distro, empty when the name doesn't follow the scheme
 */
export function parsePrebuildName(name: string): Pick<ToolFile, 'arch' | 'distro'> {
  const match = /^[^-]+-\d.*?(?:-(?<distro>[a-z]+))?-(?<arch>x86_64|aarch64)\.[^-]+$/.exec(name);
  if (!match?.groups) {
    return {};
  }
  return {
    arch: match.groups['arch'] === 'x86_64' ? 'amd64' : 'arm64',
    ...(match.groups['distro'] && { distro: match.groups['distro'] }),
  };
}

/** The distros containerbase no longer supports, their prebuilds are skipped. */
const unsupportedDistros = new Set(['bionic', 'focal']);

/**
 * Checks if a distro is no longer supported.
 * @param distro - the distro of a file, if any
 */
export function isUnsupportedDistro(distro: string | undefined): boolean {
  return distro !== undefined && unsupportedDistros.has(distro);
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
 * Creates the tasks which read the checksums of the assets of a release which
 * are files of an asset template and not known yet. A checksum list is
 * downloaded at most once for the release.
 * @param label - names the tool or package in warnings
 * @param template - the files and checksums of the tool
 * @param version - the version of the release
 * @param assets - the download urls of the assets of the release, by name
 * @param files - the known files of the version, the downloads add to it
 */
export function assetTasks(
  label: string,
  template: AssetTemplate,
  version: string,
  assets: ReadonlyMap<string, string>,
  files: ToolFile[],
): (() => Promise<void>)[] {
  const algorithm = template.algorithm ?? 'sha256';
  const { checksum: source } = template;
  let list: Promise<Map<string, string>> | undefined;
  const sums = (url: string): Promise<Map<string, string>> =>
    (list ??= fetchText(url, label).then((text) =>
      text === undefined ? new Map() : parseChecksumList(text, algorithm),
    ));
  const sidecar = async (name: string, suffixes: string[]): Promise<string | undefined> => {
    for (const url of suffixes.map((suffix) => assets.get(`${name}${suffix}`))) {
      const text = url === undefined ? undefined : await fetchText(url, label);
      if (text === undefined) {
        continue;
      }
      const sum = parseChecksumFile(text, algorithm);
      if (!sum) {
        stdout.write(`::warning::${label}: no valid ${algorithm} digest in ${url}\n`);
      }
      return sum;
    }
    return undefined;
  };
  return template
    .files(version)
    .filter(({ name }) => assets.has(name) && !files.some((file) => file.name === name))
    .map(({ name, arch }) => async () => {
      const url = assets.get(name);
      const listUrl = 'list' in source ? assets.get(source.list(version)) : undefined;
      const sum =
        'sidecar' in source
          ? await sidecar(name, source.sidecar)
          : listUrl && (await sums(listUrl)).get(name);
      if (url && sum) {
        files.push({ name, url, checksum: sum, ...(arch && { arch }) });
      }
    });
}

/**
 * Creates the tasks which read the checksums of the candidates that are not
 * known yet. The checksum files of a candidate are tried in order, the next one
 * is used when a file can't be downloaded.
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
    .map(({ name, url, checksumUrls, algorithm, arch, distro }) => async () => {
      let checksumUrl = '';
      let text: string | undefined;
      for (checksumUrl of checksumUrls) {
        text = await fetchText(checksumUrl, label);
        if (text !== undefined) {
          break;
        }
      }
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
