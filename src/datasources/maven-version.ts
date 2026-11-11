import { CompactBuilderFactory } from '@nodable/compact-builder';
import { XMLParser } from '@nodable/flexible-xml-parser';
import { z } from 'zod';

import {
  type Algorithm,
  parseChecksumFile,
  type PreviousFiles,
  runAll,
  type ToolFiles,
  withFiles,
} from '../files.ts';
import { HttpError, request } from '../http.ts';
import { logWarning } from '../log.ts';
import type { ToolFile, ToolVersion, VersioningName } from '../schema.ts';
import { belowMinimum, versionings } from '../versioning.ts';
import { sortVersions, toolVersion, toTimestamp } from '../versions.ts';
import { fetchGithubReleases } from './github-releases.ts';

/** The folder of the Apache maven distributions in Maven Central. */
const repository = 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven';

/** The repository of the containerbase maven prebuilds. */
const prebuildRepository = 'containerbase/maven-prebuild';

/** The checksum files of a distribution, the first one that exists is used. */
const checksumFiles: { suffix: string; algorithm: Algorithm }[] = [
  { suffix: '.sha512', algorithm: 'sha512' },
  // old releases like 3.0.4 only have a `.sha1` file
  { suffix: '.sha1', algorithm: 'sha1' },
];

/** The parser of `maven-metadata.xml`, keeping versions like `3.0` as text. */
const parser = new XMLParser({
  skip: { declaration: true, pi: true },
  OutputBuilder: new CompactBuilderFactory({ tags: { valueParsers: ['entity', 'trim'] } }),
});

const MavenMetadata = z.object({
  metadata: z.object({
    versioning: z.object({
      versions: z.object({
        // a single version isn't put in an array
        version: z.preprocess(
          (value) => (Array.isArray(value) ? value : [value]),
          z.array(z.string()),
        ),
      }),
    }),
  }),
});

/**
 * Downloads a checksum file. Any failure but a missing file (404) prints a
 * warning, the next build tries again.
 * @param url - the url of the checksum file
 * @returns its text and `Last-Modified` time, `missing` for a 404, or
 * `undefined` when the download failed
 */
async function fetchChecksumFile(
  url: string,
): Promise<{ text: string; lastModified: string | undefined } | 'missing' | undefined> {
  try {
    const res = await request(url);
    return { text: await res.text(), lastModified: toTimestamp(res.headers.get('last-modified')) };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return 'missing';
    }
    logWarning(`maven: no checksum from ${url}: ${String(err)}`);
    return undefined;
  }
}

/**
 * Reads the Apache distribution of a version with the checksum of its
 * `.sha512` file, or of its `.sha1` file when there is no `.sha512` one. The
 * release time is the `Last-Modified` time of that checksum file in Maven
 * Central, so a rebuilt prebuild doesn't move it. Nothing is requested when the
 * file and the release time are both known.
 * @param entry - the version, the release time is set on it
 * @param files - the known files of the version, the download adds to it
 * @param withTimestamp - whether the version still needs a release time
 */
async function fetchApacheFile(
  entry: ToolVersion,
  files: ToolFile[],
  withTimestamp: boolean,
): Promise<void> {
  const { version } = entry;
  const name = `apache-maven-${version}-bin.tar.gz`;
  const withFile = !files.some((file) => file.name === name);
  if (!withFile && !withTimestamp) {
    return;
  }
  const url = `${repository}/${version}/${name}`;
  for (const { suffix, algorithm } of checksumFiles) {
    const res = await fetchChecksumFile(`${url}${suffix}`);
    if (res === 'missing') {
      continue;
    }
    // a failed download must not fall back to a weaker checksum for good
    if (res === undefined) {
      return;
    }
    if (withTimestamp && res.lastModified) {
      entry.releaseTimestamp = res.lastModified;
    }
    if (!withFile) {
      return;
    }
    const sum = parseChecksumFile(res.text, algorithm);
    if (sum) {
      files.push({ name, url, checksum: sum });
    } else {
      logWarning(`maven: no valid ${algorithm} digest in ${url}${suffix}`);
    }
    return;
  }
}

/**
 * Fetches the releases of the containerbase maven prebuilds, the files
 * `maven-<version>.tar.xz` with their sha512. The release list stops after the
 * first page with a version which already has a prebuild file. A failure only
 * prints a warning, the prebuild files of the previous build stay.
 * @param previous - the already known files by version
 * @param versioning - the versioning of maven
 * @param minVersion - the oldest version to read
 * @returns the prebuild releases by version, only their files are used
 */
async function fetchPrebuilds(
  previous: PreviousFiles,
  versioning: VersioningName,
  minVersion: string | undefined,
): Promise<Map<string, ToolVersion>> {
  const known = new Set(
    [...previous].flatMap(([version, files]) =>
      files.some((file) => file.name === `maven-${version}.tar.xz`) ? [version] : [],
    ),
  );
  try {
    const releases = await fetchGithubReleases(
      prebuildRepository,
      known,
      previous,
      undefined,
      true,
      undefined,
      versioning,
      minVersion,
    );
    return new Map(releases.map((release) => [release.version, release]));
  } catch (err) {
    logWarning(`maven: no prebuild files: ${String(err)}`);
    return new Map();
  }
}

/**
 * Fetches the maven versions from the `maven-metadata.xml` of the Apache
 * distribution in Maven Central, prereleases flagged by the versioning. Its
 * `release` and `latest` are prereleases too, so they aren't the `latest`. Every
 * version has the Apache `apache-maven-<version>-bin.tar.gz` file and its
 * Maven Central release time, and the versions with a release of
 * `containerbase/maven-prebuild` also its `maven-<version>.tar.xz` file. The
 * prebuild release time isn't used, a rebuild of an old version would move it.
 * Neither file has an arch. Known files and release times are reused, versions
 * older than `minVersion` are skipped.
 * @param _packageName - unused, there is only maven
 * @param _known - unused, the metadata lists all versions at once
 * @param previous - the already known files by version
 * @param _template - unused, the files are always the same
 * @param fetchFiles - whether to fetch the files and release times at all
 * @param hasTimestamp - the versions which already have a release time
 * @param versioning - which versions are valid and prereleases, `maven` by default
 * @param minVersion - the oldest version to read, older ones are skipped
 */
export async function fetchMavenVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: ToolFiles,
  fetchFiles = true,
  hasTimestamp: ReadonlySet<string> = new Set(),
  versioning: VersioningName = 'maven',
  minVersion?: string,
): Promise<ToolVersion[]> {
  const { isValid, isPrerelease, compare } = versionings[versioning];
  const isTooOld = belowMinimum(versioning, minVersion);
  const xml = await (await request(`${repository}/maven-metadata.xml`)).text();
  const metadata = MavenMetadata.parse(parser.parse(xml));
  const prebuilds = fetchFiles
    ? await fetchPrebuilds(previous, versioning, minVersion)
    : new Map<string, ToolVersion>();
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  for (const version of metadata.metadata.versioning.versions.version) {
    if (!isValid(version) || isTooOld(version)) {
      continue;
    }
    const entry = toolVersion(version, { prerelease: isPrerelease(version) });
    const files = fetchFiles ? [...(previous.get(version) ?? [])] : [];
    for (const file of prebuilds.get(version)?.files ?? []) {
      if (!files.some(({ name }) => name === file.name)) {
        files.push(file);
      }
    }
    versions.push({ entry, files });
  }
  if (fetchFiles) {
    await runAll(
      versions.map(
        ({ entry, files }) =>
          () =>
            fetchApacheFile(entry, files, !hasTimestamp.has(entry.version)),
      ),
    );
  }
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compare,
  );
}
