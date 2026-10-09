import { stdout } from 'node:process';
import { z } from 'zod';
import { type PreviousFiles, checksum, runAll, withFiles } from '../files.ts';
import { HttpError, getJson } from '../http.ts';
import type { ToolFile, ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toolVersion,
} from '../versions.ts';

const baseUrl = 'https://api.adoptium.net/v3/info';

/** The largest page size the adoptium api accepts. */
const pageSize = 50;

/** The adoptium image type of the supported package names. */
const imageTypes: Record<string, string> = {
  'java-jdk': 'jdk',
  'java-jre': 'jre',
};

const AvailableReleases = z.object({
  available_lts_releases: z.array(z.number()),
});

const ReleaseVersions = z.object({
  versions: z.array(
    z.object({
      major: z.number(),
      semver: z.string(),
    }),
  ),
});
type ReleaseVersions = z.infer<typeof ReleaseVersions>;

/**
 * Fetches one page of the adoptium ga releases.
 * @param imageType - the adoptium image type, `jdk` or `jre`
 * @param page - the zero based page number
 * @returns the releases, empty when the page is past the last one
 */
async function fetchPage(imageType: string, page: number): Promise<ReleaseVersions['versions']> {
  try {
    const { versions } = await getJson(
      `${baseUrl}/release_versions?architecture=x64&heap_size=normal&image_type=${imageType}&os=linux&page=${page}&page_size=${pageSize}&project=jdk&release_type=ga&sort_order=DESC`,
      ReleaseVersions,
    );
    return versions;
  } catch (err) {
    // adoptium answers 404 when no release is left
    if (page > 0 && err instanceof HttpError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

/** The linux architectures with their adoptium name. */
const architectures = [
  { arch: 'amd64', adoptium: 'x64' },
  { arch: 'arm64', adoptium: 'aarch64' },
] as const;

const AssetReleases = z.array(
  z.object({
    version_data: z.object({ semver: z.string() }),
    binaries: z.array(
      z.object({
        package: z.object({ name: z.string(), link: z.string(), checksum: z.string() }),
      }),
    ),
  }),
);
type AssetReleases = z.infer<typeof AssetReleases>;

/** A published version which still needs the file of an architecture. */
interface PendingFiles {
  /** the files of the version, the download adds to it */
  files: ToolFile[];
  /** the feature release (major) of the version */
  major: number;
}

/**
 * Fetches one page of the adoptium ga assets of a feature release.
 * @param imageType - the adoptium image type, `jdk` or `jre`
 * @param major - the feature release
 * @param adoptium - the adoptium architecture
 * @param page - the zero based page number
 * @returns the releases, empty when the page is past the last one
 */
async function fetchAssetPage(
  imageType: string,
  major: number,
  adoptium: string,
  page: number,
): Promise<AssetReleases> {
  try {
    return await getJson(
      `https://api.adoptium.net/v3/assets/feature_releases/${major}/ga?architecture=${adoptium}&heap_size=normal&image_type=${imageType}&os=linux&page=${page}&page_size=${pageSize}&project=jdk&sort_order=DESC&vendor=eclipse`,
      AssetReleases,
    );
  } catch (err) {
    // adoptium answers 404 when no release is left
    if (err instanceof HttpError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

/**
 * Reads the files of one feature release and architecture, newest first, until
 * the files of all the wanted versions are known. A failure only prints a
 * warning, the next build tries again.
 * @param imageType - the adoptium image type, `jdk` or `jre`
 * @param major - the feature release
 * @param architecture - the architecture to read the files of
 * @param wanted - the versions which need a file, by version
 */
async function fetchFeatureFiles(
  imageType: string,
  major: number,
  architecture: (typeof architectures)[number],
  wanted: Map<string, ToolFile[]>,
): Promise<void> {
  try {
    for (let page = 0; wanted.size; page++) {
      const releases = await fetchAssetPage(imageType, major, architecture.adoptium, page);
      if (!releases.length) {
        break;
      }
      for (const release of releases) {
        const files = wanted.get(release.version_data.semver);
        const pkg = release.binaries[0]?.package;
        const sum = checksum(pkg?.checksum, 'sha256');
        if (files && pkg && sum) {
          files.push({ name: pkg.name, url: pkg.link, checksum: sum, arch: architecture.arch });
          wanted.delete(release.version_data.semver);
        }
      }
    }
  } catch (err) {
    stdout.write(
      `::warning::java: no files for feature ${major} (${architecture.arch}): ${String(err)}\n`,
    );
  }
}

/**
 * Fetches the adoptium ga releases for linux x64, with the same filters as the
 * containerbase java resolver. The version is the adoptium semver, like
 * `25.0.2+10.0.LTS`, which `install-tool` installs. Releases of an lts major
 * are flagged as lts.
 * The releases are requested newest first, so paging stops after the first
 * page with an already known version.
 * The files (x64 and aarch64) come from the assets of each feature release,
 * which is only requested when one of its versions lacks the file of an
 * architecture. Known files are reused by name.
 * @param packageName - `java-jdk` or `java-jre`
 * @param known - the versions which are already known
 * @param previous - the already known files by version
 * @throws for an unknown package name
 */
export async function fetchJavaVersions(
  packageName: string,
  known: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
): Promise<ToolVersion[]> {
  const imageType = imageTypes[packageName];
  if (!imageType) {
    throw new Error(`Unknown java package ${packageName}`);
  }

  const { available_lts_releases } = await getJson(
    `${baseUrl}/available_releases`,
    AvailableReleases,
  );
  const ltsMajors = new Set(available_lts_releases);

  const versions = new Map<string, ToolVersion & PendingFiles>();
  for (let page = 0; ; page++) {
    const releases = await fetchPage(imageType, page);
    let foundKnown = false;
    for (const { major, semver } of releases) {
      if (!isSemver(semver)) {
        continue;
      }
      foundKnown ||= known.has(semver);
      versions.set(semver, {
        ...toolVersion(semver, {
          prerelease: isSemverPrerelease(semver),
          lts: ltsMajors.has(major),
        }),
        files: [...(previous.get(semver) ?? [])],
        major,
      });
    }
    if (foundKnown || releases.length < pageSize) {
      break;
    }
  }

  const tasks = new Map<string, () => Promise<void>>();
  for (const architecture of architectures) {
    const missing = new Map<number, Map<string, ToolFile[]>>();
    for (const { version, files, major } of versions.values()) {
      if (!files.some((file) => file.arch === architecture.arch)) {
        missing.set(major, (missing.get(major) ?? new Map()).set(version, files));
      }
    }
    for (const [major, wanted] of missing) {
      tasks.set(`${major}-${architecture.arch}`, () =>
        fetchFeatureFiles(imageType, major, architecture, wanted),
      );
    }
  }
  await runAll([...tasks.values()]);

  return sortVersions(
    [...versions.values()].map(({ files, major: _major, ...entry }) => withFiles(entry, files)),
    compareSemver,
  );
}
