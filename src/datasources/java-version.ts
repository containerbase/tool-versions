import { stdout } from 'node:process';
import { z } from 'zod';
import { type FileTemplate, type PreviousFiles, checksum, runAll, withFiles } from '../files.ts';
import { HttpError, getJson } from '../http.ts';
import type { ToolFile, ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toTimestamp,
  toolVersion,
} from '../versions.ts';

const baseUrl = 'https://api.adoptium.net/v3/info';

/** The largest page size the adoptium release versions api accepts. */
const pageSize = 50;

/** The page size of the assets api, which clamps larger ones to 20. */
const assetPageSize = 20;

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
    // when the release was published
    timestamp: z.string().optional(),
    binaries: z.array(
      z.object({
        package: z.object({ name: z.string(), link: z.string(), checksum: z.string() }),
      }),
    ),
  }),
);
type AssetReleases = z.infer<typeof AssetReleases>;

/** A published version which may still need files or a release time. */
interface PendingFiles {
  /** the files of the version, the download adds to it */
  files: ToolFile[];
  /** the feature release (major) of the version */
  major: number;
  /** whether the release time is not known yet, the download sets it */
  missingTimestamp: boolean;
  releaseTimestamp?: string | undefined;
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
      `https://api.adoptium.net/v3/assets/feature_releases/${major}/ga?architecture=${adoptium}&heap_size=normal&image_type=${imageType}&os=linux&page=${page}&page_size=${assetPageSize}&project=jdk&sort_order=DESC&vendor=eclipse`,
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
 * Whether a version still needs something from the assets of an architecture.
 * @param pending - the version
 * @param arch - the architecture of the assets
 * @param withTimestamp - whether these assets provide the release times
 */
function isWanted(
  pending: PendingFiles,
  arch: (typeof architectures)[number]['arch'],
  withTimestamp: boolean,
): boolean {
  return (
    !pending.files.some((file) => file.arch === arch) ||
    (withTimestamp && pending.missingTimestamp && !pending.releaseTimestamp)
  );
}

/**
 * Reads the files and release times of one feature release and architecture,
 * newest first, until all the wanted versions have them. A failure only prints
 * a warning, the next build tries again.
 * @param imageType - the adoptium image type, `jdk` or `jre`
 * @param major - the feature release
 * @param architecture - the architecture to read the files of
 * @param versions - the versions of the feature release, by version
 * @param withTimestamp - whether to read the release times too
 */
async function fetchFeatureFiles(
  imageType: string,
  major: number,
  architecture: (typeof architectures)[number],
  versions: Map<string, PendingFiles>,
  withTimestamp: boolean,
): Promise<void> {
  const wanted = new Map(
    [...versions].filter(([, pending]) => isWanted(pending, architecture.arch, withTimestamp)),
  );
  try {
    for (let page = 0; wanted.size; page++) {
      const releases = await fetchAssetPage(imageType, major, architecture.adoptium, page);
      if (!releases.length) {
        break;
      }
      for (const release of releases) {
        const pending = wanted.get(release.version_data.semver);
        const pkg = release.binaries[0]?.package;
        const sum = checksum(pkg?.checksum, 'sha256');
        if (!pending) {
          continue;
        }
        if (pkg && sum && !pending.files.some((file) => file.arch === architecture.arch)) {
          pending.files.push({
            name: pkg.name,
            url: pkg.link,
            checksum: sum,
            arch: architecture.arch,
          });
        }
        if (withTimestamp && !pending.releaseTimestamp) {
          const time = toTimestamp(release.timestamp);
          if (time) {
            pending.releaseTimestamp = time;
          }
        }
        if (!isWanted(pending, architecture.arch, withTimestamp)) {
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
 * architecture or a release time (taken from the x64 assets). Known files are
 * reused by name.
 * @param packageName - `java-jdk` or `java-jre`
 * @param known - the versions which are already known
 * @param previous - the already known files by version
 * @param _template - unused, the files come from the adoptium assets
 * @param fetchFiles - whether to fetch the files at all
 * @param hasTimestamp - the versions which already have a release time, the
 * assets are requested for the others
 * @throws for an unknown package name
 */
export async function fetchJavaVersions(
  packageName: string,
  known: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: FileTemplate,
  fetchFiles = true,
  hasTimestamp: ReadonlySet<string> = new Set(),
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
  /**
   * Adds a version with its flags and its previous files.
   * @param semver - the version
   * @param major - its feature release
   */
  const add = (semver: string, major: number): void => {
    versions.set(semver, {
      ...toolVersion(semver, {
        prerelease: isSemverPrerelease(semver),
        lts: ltsMajors.has(major),
      }),
      files: fetchFiles ? [...(previous.get(semver) ?? [])] : [],
      major,
      missingTimestamp: !hasTimestamp.has(semver),
    });
  };
  for (let page = 0; ; page++) {
    const releases = await fetchPage(imageType, page);
    let foundKnown = false;
    for (const { major, semver } of releases) {
      if (!isSemver(semver)) {
        continue;
      }
      foundKnown ||= known.has(semver);
      add(semver, major);
    }
    if (foundKnown || releases.length < pageSize) {
      break;
    }
  }
  // the paging stops early, so the older published versions still need files
  for (const semver of known) {
    if (!versions.has(semver) && isSemver(semver)) {
      add(semver, Number(semver.split('.')[0]));
    }
  }

  // the release times come from the assets of the first architecture
  const tasks: (() => Promise<void>)[] = [];
  for (const [position, architecture] of (fetchFiles ? architectures : []).entries()) {
    const withTimestamp = position === 0;
    const features = new Map<number, Map<string, PendingFiles>>();
    for (const [version, pending] of versions) {
      if (isWanted(pending, architecture.arch, withTimestamp)) {
        features.set(
          pending.major,
          (features.get(pending.major) ?? new Map()).set(version, pending),
        );
      }
    }
    for (const [major, wanted] of features) {
      tasks.push(() => fetchFeatureFiles(imageType, major, architecture, wanted, withTimestamp));
    }
  }
  await runAll(tasks);

  return sortVersions(
    [...versions.values()].map(
      ({ files, major: _major, missingTimestamp: _missing, releaseTimestamp, ...entry }) =>
        withFiles({ ...entry, ...(releaseTimestamp && { releaseTimestamp }) }, files),
    ),
    compareSemver,
  );
}
