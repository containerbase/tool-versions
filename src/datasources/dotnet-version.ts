import { z } from 'zod';
import {
  type Arch,
  type PreviousFiles,
  type ToolFiles,
  checksum,
  runAll,
  withFiles,
} from '../files.ts';
import { getJson } from '../http.ts';
import { logWarning } from '../log.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { versionings } from '../versioning.ts';
import { sortVersions, toTimestamp, toolVersion } from '../versions.ts';

/** The release metadata of the .NET channels. */
const indexUrl = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/releases-index.json';

const ReleasesIndex = z.object({
  'releases-index': z.array(z.object({ 'releases.json': z.string() })),
});

const Sdk = z.object({
  version: z.string(),
  files: z
    .array(
      z.object({
        rid: z.string().optional(),
        name: z.string().optional(),
        hash: z.string().optional(),
      }),
    )
    .default([]),
});

const Channel = z.object({
  releases: z.array(
    z.object({
      'release-date': z.string().nullish(),
      sdk: Sdk.nullish(),
      sdks: z.array(Sdk).nullish(),
    }),
  ),
});

/** The linux runtime ids of the sdk archives, by containerbase arch. */
const rids: Record<string, Arch> = { 'linux-x64': 'amd64', 'linux-arm64': 'arm64' };

/**
 * Reads the sdk versions of a channel with their linux archives and the sha512
 * hashes of the release metadata. The archive is the one the containerbase CLI
 * downloads from builds.dotnet.microsoft.com, not the url of the metadata,
 * which differs for old releases.
 * @param url - the `releases.json` of the channel
 * @param versioning - which versions are valid and prereleases
 * @returns the versions of the channel, with their files
 */
async function readChannel(
  url: string,
  versioning: VersioningName,
): Promise<{ entry: ToolVersion; files: ToolFile[] }[]> {
  const { isValid, isPrerelease } = versionings[versioning];
  const { releases } = await getJson(url, Channel);
  const found = new Map<string, { entry: ToolVersion; files: ToolFile[] }>();
  for (const release of releases) {
    for (const sdk of [release.sdk, ...(release.sdks ?? [])]) {
      if (!sdk || found.has(sdk.version) || !isValid(sdk.version)) {
        continue;
      }
      const files = sdk.files.flatMap(({ rid, name, hash }) => {
        const arch = rid ? rids[rid] : undefined;
        const sum = checksum(hash, 'sha512');
        // the tar.gz of the sdk, not the zip or the installer
        if (!rid || !arch || !sum || name !== `dotnet-sdk-${rid}.tar.gz`) {
          return [];
        }
        const file = `dotnet-sdk-${sdk.version}-${rid}.tar.gz`;
        return [
          {
            name: file,
            url: `https://builds.dotnet.microsoft.com/dotnet/Sdk/${sdk.version}/${file}`,
            checksum: sum,
            arch,
          },
        ];
      });
      found.set(sdk.version, {
        entry: toolVersion(sdk.version, {
          prerelease: isPrerelease(sdk.version),
          releaseTimestamp: toTimestamp(release['release-date']),
        }),
        files,
      });
    }
  }
  return [...found.values()];
}

/**
 * Fetches the .NET sdk versions from the release metadata of Microsoft: the
 * `releases-index.json` lists the channels, the `releases.json` of each lists
 * the sdks of its releases with the sha512 of every archive. A published
 * checksum is used, so nothing is downloaded. A channel which can't be read is
 * skipped with a warning, its versions stay as they were published.
 * @param _packageName - unused, there is only the sdk
 * @param _known - unused, the metadata has all releases
 * @param _previous - unused, the files come from the metadata
 * @param _template - unused, the metadata lists the files
 * @param fetchFiles - whether to publish the files at all
 * @param _hasTimestamp - unused, the release date is part of the metadata
 * @param versioning - how the versions are validated and sorted, `semver` by default
 */
export async function fetchDotnetVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  _previous?: PreviousFiles,
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'semver',
): Promise<ToolVersion[]> {
  const { compare } = versionings[versioning];
  const index = await getJson(indexUrl, ReleasesIndex);
  const channels: { entry: ToolVersion; files: ToolFile[] }[][] = [];
  await runAll(
    index['releases-index'].map(({ 'releases.json': url }) => async () => {
      try {
        channels.push(await readChannel(url, versioning));
      } catch (err) {
        logWarning(`dotnet: no releases from ${url}: ${String(err)}`);
      }
    }),
  );
  return sortVersions(
    channels.flat().map(({ entry, files }) => withFiles(entry, fetchFiles ? files : [])),
    compare,
  );
}
