import { z } from 'zod';
import {
  type Arch,
  type PreviousFiles,
  type ToolFiles,
  fetchText,
  parseChecksumList,
  runAll,
  withFiles,
} from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { versionings } from '../versioning.ts';
import { sortVersions, toolVersion } from '../versions.ts';

const HashicorpIndex = z.object({
  versions: z.record(
    z.string(),
    z.object({
      shasums: z.string().optional(),
      builds: z.array(
        z.object({
          os: z.string(),
          arch: z.string(),
          filename: z.string(),
          url: z.string(),
        }),
      ),
    }),
  ),
});

/** The containerbase architectures with their name in the hashicorp builds. */
const archs: Record<string, Arch> = { amd64: 'amd64', arm64: 'arm64' };

/**
 * Fetches the releases of a hashicorp product from releases.hashicorp.com,
 * with the linux `amd64` and `arm64` zip files of each release. The checksums
 * come from the `SHA256SUMS` file of the release, which is downloaded once per
 * release and only for versions with missing files, like the containerbase
 * terraform installer does. A release whose checksum file is missing (404)
 * keeps its files out, other failures print a warning and are retried by the
 * next build. The index has no release times, so `releaseTimestamp` is left out.
 * @param packageName - the product, like `terraform`
 * @param _known - unused, the index lists all releases at once
 * @param previous - the already known files by version
 * @param _template - unused, the builds list the files
 * @param fetchFiles - whether to fetch the files at all
 * @param _hasTimestamp - unused, there are no release times
 * @param versioning - which versions are valid and prereleases, `semver` by default
 */
export async function fetchHashicorpReleases(
  packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'semver',
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const { versions: releases } = await getJson(
    `https://releases.hashicorp.com/${packageName}/index.json`,
    HashicorpIndex,
  );
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  const tasks: (() => Promise<void>)[] = [];
  for (const [version, { shasums, builds }] of Object.entries(releases)) {
    if (!isValid(version)) {
      continue;
    }
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    versions.push({ entry: toolVersion(version, { prerelease: isPrerelease(version) }), files });
    const wanted = fetchFiles
      ? builds.filter(
          ({ os, arch, filename }) =>
            os === 'linux' && arch in archs && !files.some((file) => file.name === filename),
        )
      : [];
    if (wanted.length && shasums) {
      tasks.push(async () => {
        const text = await fetchText(
          `https://releases.hashicorp.com/${packageName}/${version}/${shasums}`,
          packageName,
        );
        const sums =
          text === undefined ? new Map<string, string>() : parseChecksumList(text, 'sha256');
        for (const { arch, filename, url } of wanted) {
          const checksum = sums.get(filename);
          const mapped = archs[arch];
          if (checksum && mapped) {
            files.push({ name: filename, url, checksum, arch: mapped });
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
