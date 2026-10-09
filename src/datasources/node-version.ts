import { z } from 'zod';
import {
  type FileTemplate,
  type PreviousFiles,
  checksum,
  fetchText,
  runAll,
  withFiles,
} from '../files.ts';
import { getJson } from '../http.ts';
import type { ToolFile, ToolVersion } from '../schema.ts';
import {
  compareSemver,
  isSemver,
  isSemverPrerelease,
  sortVersions,
  toTimestamp,
  toolVersion,
} from '../versions.ts';

const NodeReleases = z.array(
  z.object({
    version: z.string(),
    // the release date, like `2025-10-24`
    date: z.string().optional(),
    // the lts codename, or `false`
    lts: z.union([z.string(), z.boolean()]),
  }),
);

/** The linux archives of a node release, by containerbase arch. */
const archives = [
  { arch: 'amd64', suffix: 'linux-x64.tar.xz' },
  { arch: 'arm64', suffix: 'linux-arm64.tar.xz' },
] as const;

/**
 * Reads the linux archives of a release from its `SHASUMS256.txt`, unless the
 * known files already have them.
 * @param version - the version without `v`
 * @param files - the known files of the version, the download adds to it
 */
async function fetchNodeFiles(version: string, files: ToolFile[]): Promise<void> {
  const wanted = archives
    .map((archive) => ({ ...archive, name: `node-v${version}-${archive.suffix}` }))
    .filter(({ name }) => !files.some((file) => file.name === name));
  if (!wanted.length) {
    return;
  }
  const base = `https://nodejs.org/dist/v${version}`;
  const text = await fetchText(`${base}/SHASUMS256.txt`, 'node');
  if (text === undefined) {
    return;
  }
  const sums = new Map(
    text
      .split('\n')
      .map((line) => /^(\S+)\s+\*?(\S+)$/.exec(line.trim()))
      .flatMap((match) => (match?.[1] && match[2] ? [[match[2], match[1]] as const] : [])),
  );
  for (const { name, arch } of wanted) {
    const sum = checksum(sums.get(name), 'sha256');
    if (sum) {
      files.push({ name, url: `${base}/${name}`, checksum: sum, arch });
    }
  }
}

/**
 * Fetches the node releases from nodejs.org, like the containerbase node
 * resolver. The leading `v` is dropped and a release with an lts codename is
 * flagged as lts. The linux archives come with their sha256 from the
 * `SHASUMS256.txt` of the release, known files are not fetched again.
 * @param _packageName - unused, nodejs.org only has node
 * @param _known - unused, nodejs.org lists all releases at once
 * @param previous - the already known files by version
 * @param _template - unused, the files are always the linux archives
 * @param fetchFiles - whether to fetch the files at all
 */
export async function fetchNodeVersions(
  _packageName: string,
  _known?: ReadonlySet<string>,
  previous: PreviousFiles = new Map(),
  _template?: FileTemplate,
  fetchFiles = true,
): Promise<ToolVersion[]> {
  const releases = await getJson('https://nodejs.org/dist/index.json', NodeReleases);
  const versions: { entry: ToolVersion; files: ToolFile[] }[] = [];
  for (const release of releases) {
    const version = release.version.replace(/^v/, '');
    if (!isSemver(version)) {
      continue;
    }
    const entry = toolVersion(version, {
      prerelease: isSemverPrerelease(version),
      lts: typeof release.lts === 'string',
      releaseTimestamp: toTimestamp(release.date),
    });
    versions.push({ entry, files: fetchFiles ? [...(previous.get(version) ?? [])] : [] });
  }
  if (fetchFiles) {
    await runAll(
      versions.map(
        ({ entry, files }) =>
          () =>
            fetchNodeFiles(entry.version, files),
      ),
    );
  }
  return sortVersions(
    versions.map(({ entry, files }) => withFiles(entry, files)),
    compareSemver,
  );
}
