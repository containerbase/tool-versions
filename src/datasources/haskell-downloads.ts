import {
  type Arch,
  type PreviousFiles,
  type ToolFiles,
  fetchText,
  parseChecksumList,
  runAll,
  withFiles,
} from '../files.ts';
import { request } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { belowMinimum, versionings } from '../versioning.ts';
import { sortVersions, toolVersion } from '../versions.ts';

/** A product of downloads.haskell.org with a folder per release. */
interface Product {
  /** the folder which lists the releases */
  listing: string;
  /** the version of a folder name, `undefined` for other folders */
  version: (folder: string) => string | undefined;
  /** the folder of a release, with the `SHA256SUMS` and the files */
  releaseUrl: (version: string) => string;
  /** the file name of each architecture for a version */
  files: (version: string) => Record<Arch, string>;
}

/** The cabal version from which only a generic linux build is published. */
const cabalGeneric = '3.18.0.0';

/** The products by package name. */
const products: Record<string, Product> = {
  ghc: {
    listing: 'https://downloads.haskell.org/~ghc/',
    version: (folder) => /^\d+(?:\.\d+)+$/.exec(folder)?.[0],
    releaseUrl: (version) => `https://downloads.haskell.org/~ghc/${version}/`,
    // the static deb10 build is compatible with all supported ubuntu versions
    files: (version) => ({
      amd64: `ghc-${version}-x86_64-deb10-linux.tar.xz`,
      arm64: `ghc-${version}-aarch64-deb10-linux.tar.xz`,
    }),
  },
  cabal: {
    listing: 'https://downloads.haskell.org/~cabal/',
    version: (folder) => /^cabal-install-(\d+(?:\.\d+)+)$/.exec(folder)?.[1],
    releaseUrl: (version) => `https://downloads.haskell.org/~cabal/cabal-install-${version}/`,
    files: (version) => {
      // the generic linux build since 3.18, the static deb10 one before
      const os =
        versionings.docker.compare(version, cabalGeneric) >= 0 ? 'linux-unknown' : 'linux-deb10';
      return {
        amd64: `cabal-install-${version}-x86_64-${os}.tar.xz`,
        arm64: `cabal-install-${version}-aarch64-${os}.tar.xz`,
      };
    },
  },
};

/**
 * Lists the folders of a directory listing page.
 * @param html - the page
 * @returns the folder names, without the slash
 */
function folders(html: string): string[] {
  return [...html.matchAll(/href="(?:\.\/)?([^"/?#]+)\/"/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

/**
 * Fetches the releases of a product of downloads.haskell.org: the folders of
 * its directory listing are the versions, the linux `amd64` and `arm64`
 * archives of a release and their checksums come from its `SHA256SUMS`, as the
 * containerbase installers read them. The `SHA256SUMS` is downloaded once per
 * release, only for versions with missing files. Releases without such an
 * archive have no file. The listing has no release times.
 * @param packageName - `ghc` or `cabal`
 * @param _known - unused, the listing has all releases
 * @param previous - the already known files by version
 * @param _template - unused, the product lists its files
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, there are no release times
 * @param versioning - which versions are valid and prereleases, `docker` by default
 * @param minVersion - the oldest version to read, older releases are skipped
 * @throws for an unknown package name
 */
export async function fetchHaskellDownloads(
  packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'docker',
  minVersion?: string,
): Promise<ToolVersion[]> {
  const product = products[packageName];
  if (!product) {
    throw new Error(`Unknown haskell package ${packageName}`);
  }
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const isTooOld = belowMinimum(versioning, minVersion);
  const html = await (await request(product.listing)).text();
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  for (const folder of folders(html)) {
    const version = product.version(folder);
    if (!version || !isValid(version) || isTooOld(version)) {
      continue;
    }
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    versions.push({ entry: toolVersion(version, { prerelease: isPrerelease(version) }), files });
    const names = product.files(version);
    const wanted = (['amd64', 'arm64'] as const).filter(
      (arch) => !files.some((file) => file.name === names[arch]),
    );
    if (fetchFiles && wanted.length) {
      tasks.push(async () => {
        const base = product.releaseUrl(version);
        const text = await fetchText(`${base}SHA256SUMS`, packageName);
        const sums =
          text === undefined ? new Map<string, string>() : parseChecksumList(text, 'sha256');
        for (const arch of wanted) {
          const name = names[arch];
          const checksum = sums.get(name);
          if (checksum) {
            files.push({ name, url: `${base}${name}`, checksum, arch });
          }
        }
      });
    }
  }
  await runAll(tasks);
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
