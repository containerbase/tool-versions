import { computeChecksumTasks } from './download.ts';
import { HttpError, request } from './http.ts';
import { logWarning } from './log.ts';
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
  /** compute the checksum by downloading the file, as there is no checksum file */
  compute?: boolean;
  arch?: ToolFile['arch'];
  distro?: ToolFile['distro'];
}

/** Lists the files of a version, `version` is without a leading `v`. */
export type FileTemplate = (version: string) => FileCandidate[];

/** The templates whose files have their checksum computed. */
const computing = new WeakSet<FileTemplate>();

/**
 * Marks a template whose files have no published checksum, so they are
 * computed by downloading them, and a list of releases has to be read
 * completely to find the files which still lack one.
 * @param template - the template
 * @returns the template
 */
export function computed(template: FileTemplate): FileTemplate {
  computing.add(template);
  return template;
}

/** The tag parts before the version of the templates which have them. */
const prefixes = new WeakMap<FileTemplate, readonly string[]>();

/**
 * Sets the tag parts before the version of a template, for repositories whose
 * tags aren't `v<version>` or `<version>`. A tag with none of them is skipped.
 * @param template - the template
 * @param tagPrefixes - the prefixes, the first one a tag starts with is used
 * @returns the template
 */
export function withTagPrefixes(template: FileTemplate, ...tagPrefixes: string[]): FileTemplate {
  prefixes.set(template, tagPrefixes);
  return template;
}

/**
 * The tag parts before the version of a template, `undefined` when its tags are
 * `v<version>` or `<version>`.
 * @param template - how the files are listed
 */
export function tagPrefixes(template: ToolFiles | undefined): readonly string[] | undefined {
  if (typeof template === 'function') {
    return prefixes.get(template);
  }
  return template?.tagPrefix === undefined ? undefined : [template.tagPrefix];
}

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
   * one which exists is used, a `list` asset with the checksums of many files,
   * or `compute` when the release publishes none, so it is computed by
   * downloading the file once.
   */
  checksum: { sidecar: string[] } | { list: (version: string) => string } | { compute: true };
  /**
   * Compute the checksum of a file by downloading it when the release has no
   * checksum asset for it, which old releases of some tools lack.
   */
  computeMissing?: boolean;
  /**
   * The algorithm of the published checksums, `sha256` by default. Computed
   * checksums are always sha256.
   */
  algorithm?: Algorithm;
  /** the tag part before the version, for tags which aren't `v<version>` or `<version>` */
  tagPrefix?: string;
}

/** How the files of a version are listed, by template function or release assets. */
export type ToolFiles = FileTemplate | AssetTemplate;

/** An asset of a release. */
export interface ReleaseAsset {
  /** the download url */
  url: string;
  /** the `sha256:<hex>` digest GitHub computed on upload, if it has one */
  digest?: string | null | undefined;
}

/**
 * Whether the files of a template may be computed by downloading them, so a
 * list of releases has to be read completely to find the ones which still lack
 * a checksum.
 * @param template - how the files are listed
 */
export function mayCompute(template: ToolFiles | undefined): boolean {
  if (typeof template === 'function') {
    return computing.has(template);
  }
  return (
    template !== undefined && (Boolean(template.computeMissing) || 'compute' in template.checksum)
  );
}

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
      logWarning(`${label}: no checksum from ${url}: ${String(err)}`);
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
 * downloaded at most once for the release. A file which has no published
 * checksum is computed by downloading it when the template says so, using the
 * digest GitHub has for the asset if there is one, see `computeChecksumTasks`.
 * @param label - names the tool or package in warnings
 * @param template - the files and checksums of the tool
 * @param version - the version of the release
 * @param assets - the assets of the release, by name
 * @param files - the known files of the version, the downloads add to it
 */
export function assetTasks(
  label: string,
  template: AssetTemplate,
  version: string,
  assets: ReadonlyMap<string, ReleaseAsset>,
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
    for (const url of suffixes.map((suffix) => assets.get(`${name}${suffix}`)?.url)) {
      const text = url === undefined ? undefined : await fetchText(url, label);
      if (text === undefined) {
        continue;
      }
      const sum = parseChecksumFile(text, algorithm);
      if (!sum) {
        logWarning(`${label}: no valid ${algorithm} digest in ${url}`);
      }
      return sum;
    }
    return undefined;
  };
  /** Whether the release has a checksum asset for the file. */
  const published = (name: string): boolean =>
    'sidecar' in source
      ? source.sidecar.some((suffix) => assets.has(`${name}${suffix}`))
      : 'list' in source && assets.has(source.list(version));
  return template
    .files(version)
    .filter(({ name }) => assets.has(name) && !files.some((file) => file.name === name))
    .flatMap(({ name, arch }) => {
      const asset = assets.get(name);
      if (!asset) {
        return [];
      }
      const compute = 'compute' in source || (template.computeMissing && !published(name));
      if (compute) {
        // the digest of GitHub is a published checksum, which costs no download
        const digest = /^sha256:[0-9a-f]{64}$/.exec(asset.digest ?? '')?.[0];
        return digest
          ? [
              () => {
                files.push({ name, url: asset.url, checksum: digest, ...(arch && { arch }) });
                return Promise.resolve();
              },
            ]
          : computeChecksumTasks(label, [{ name, url: asset.url, ...(arch && { arch }) }], files);
      }
      return [
        async () => {
          const listUrl = 'list' in source ? assets.get(source.list(version))?.url : undefined;
          const sum =
            'sidecar' in source
              ? await sidecar(name, source.sidecar)
              : listUrl && (await sums(listUrl)).get(name);
          if (sum) {
            files.push({ name, url: asset.url, checksum: sum, ...(arch && { arch }) });
          }
        },
      ];
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
  const unknown = candidates.filter(({ name }) => !files.some((file) => file.name === name));
  const toCompute = unknown.filter(({ compute }) => compute);
  return [
    ...computeChecksumTasks(label, toCompute, files),
    ...unknown
      .filter(({ compute }) => !compute)
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
          logWarning(`${label}: no valid ${algorithm} digest in ${checksumUrl}`);
          return;
        }
        files.push({ name, url, checksum: sum, ...(arch && { arch }), ...(distro && { distro }) });
      }),
  ];
}
