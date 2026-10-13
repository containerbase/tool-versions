import { XMLParser } from '@nodable/flexible-xml-parser';
import { z } from 'zod';
import {
  type Algorithm,
  type PreviousFiles,
  type ToolFiles,
  checksum,
  withFiles,
} from '../files.ts';
import { request } from '../http.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { versionings } from '../versioning.ts';
import { sortVersions, toolVersion } from '../versions.ts';

/** The android sdk repository, which lists all packages. */
const repositoryUrl = 'https://dl.google.com/android/repository/repository2-3.xml';

/** The folder the archive urls of the repository are relative to. */
const archiveBase = 'https://dl.google.com/android/repository/';

/** The checksum types of the repository which a file can carry. */
const algorithms: Partial<Record<string, Algorithm>> = {
  sha1: 'sha1',
  sha256: 'sha256',
  sha512: 'sha512',
};

/**
 * The parser of the repository, configured like the containerbase CLI's: the
 * attributes of a tag are grouped under `@`, the namespace prefixes are
 * dropped and the parts which aren't needed are skipped, as the file is big.
 */
const parser = new XMLParser({
  attributes: { prefix: '', groupBy: '@' },
  skip: {
    attributes: false,
    declaration: true,
    pi: true,
    nsPrefix: true,
    tags: [
      'sdk::sdk-repository.license',
      'sdk::sdk-repository.remotePackage.display-name',
      'sdk::sdk-repository.remotePackage.type-details',
      'sdk::sdk-repository.remotePackage.uses-license',
    ],
  },
});

/**
 * Wraps a schema so a single element, which the parser doesn't put in an
 * array, and no element at all both give a list.
 * @param item - the schema of an element
 */
function listOf<T extends z.ZodType>(item: T): z.ZodType<z.output<T>[]> {
  return z.preprocess(
    (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]),
    z.array(item),
  );
}

const Channel = z.object({
  '@': z.object({ id: z.string() }),
  '#text': z.string(),
});

const Archive = z.object({
  complete: z.object({
    checksum: z.object({
      '@': z.object({ type: z.string() }),
      '#text': z.string(),
    }),
    url: z.string(),
  }),
  'host-os': z.string().optional(),
});

const RemotePackage = z.object({
  '@': z.object({ path: z.string() }),
  channelRef: z.object({ '@': z.object({ ref: z.string() }) }),
  revision: z.object({
    major: z.number(),
    minor: z.number().optional(),
    micro: z.number().optional(),
    preview: z.number().optional(),
  }),
  archives: z.object({ archive: listOf(Archive) }),
});

const Repository = z.object({
  'sdk-repository': z.object({
    channel: listOf(Channel),
    remotePackage: listOf(RemotePackage),
  }),
});

/**
 * Reads the linux file of the archives of a package.
 * @param archives - the archives of the package
 * @returns the file, or `undefined` without a linux archive with a usable checksum
 */
function linuxFile(archives: z.output<typeof Archive>[]): ToolFile | undefined {
  const archive = archives.find((entry) => entry['host-os'] === 'linux');
  const algorithm = algorithms[archive?.complete.checksum['@'].type ?? ''];
  const sum = algorithm && checksum(archive?.complete.checksum['#text'].trim(), algorithm);
  const url = archive?.complete.url;
  // the zip is the same for all linux architectures, so the file has no arch
  return url && sum
    ? { name: url.split('/').pop() ?? url, url: `${archiveBase}${url}`, checksum: sum }
    : undefined;
}

/**
 * Fetches the versions of the android sdk command-line tools from Google's
 * repository, like the containerbase CLI: the `cmdline-tools;<x>` packages
 * (not `latest`) whose version is the revision without its zero parts, so
 * `13.0` is `13`. The first package of a version wins. Packages of the beta,
 * dev and canary channels are prereleases. The linux archive with its checksum
 * is the file of a version. There are no release times.
 * @param _packageName - unused, there is only the command-line tools
 * @param _known - unused, the repository has all packages
 * @param _previous - unused, the files come from the repository
 * @param _template - unused, the repository lists the files
 * @param fetchFiles - whether to publish the files at all
 * @param _hasTimestamp - unused, there are no release times
 * @param versioning - how the versions are validated and sorted, `docker` by default
 */
export async function fetchAndroidSdkVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  _previous?: PreviousFiles,
  _template?: ToolFiles,
  fetchFiles = true,
  _hasTimestamp?: ReadonlySet<string>,
  versioning: VersioningName = 'docker',
): Promise<ToolVersion[]> {
  const { isValid, compare } = versionings[versioning];
  const xml = await (await request(repositoryUrl)).text();
  const { 'sdk-repository': repository } = Repository.parse(parser.parse(xml));
  const channels = new Map(
    repository.channel.map((channel) => [channel['@'].id, channel['#text']]),
  );
  const versions = new Map<string, ToolVersion>();
  for (const pkg of repository.remotePackage) {
    const { path } = pkg['@'];
    if (!path.startsWith('cmdline-tools;') || path === 'cmdline-tools;latest') {
      continue;
    }
    const { major, minor, micro, preview } = pkg.revision;
    // zero parts are left out, as the containerbase CLI does
    const version = [major, minor, micro, preview].filter(Boolean).join('.');
    if (!isValid(version) || versions.has(version)) {
      continue;
    }
    const file = linuxFile(pkg.archives.archive);
    versions.set(
      version,
      withFiles(
        toolVersion(version, {
          prerelease: channels.get(pkg.channelRef['@'].ref) !== 'stable',
        }),
        fetchFiles && file ? [file] : [],
      ),
    );
  }
  return sortVersions([...versions.values()], compare);
}
