import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { type ToolMetadata, tools } from '@containerbase/base';
import nock from 'nock';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from './build.ts';
import { integrity } from './output.ts';
import { readArchivePrevious } from './previous.ts';
import {
  type PreviousToolVersions,
  type Source,
  type ToolFile,
  ToolIndex,
  type ToolVersions,
} from './schema.ts';
import { toolSources } from './tools.ts';
import { versionings } from './versioning.ts';

// adds tools with minimum versions, so the tests don't depend on the minimums
// of real tools: `min-test` has one which doesn't fit its versioning, and
// `distro-test` has a floor for resolute
vi.mock('@containerbase/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@containerbase/base')>();
  return {
    ...actual,
    tools: {
      ...actual.tools,
      'min-test': { minVersion: '18.09.0' },
      'distro-test': { minVersion: '1.0.0', distroMinVersion: { resolute: '2.0.0' } },
    },
  };
});

const now = new Date('2026-10-08T12:00:00.000Z');
const registry = 'https://registry.npmjs.org';
const schemas = 'https://containerbase.github.io/tool-versions/v1';
const pnpmLinks = { sourceUrl: 'https://github.com/pnpm/pnpm', homepage: 'https://pnpm.io' };
const pnpmSource: Record<string, Source> = {
  pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
};

/**
 * A previously published file of pnpm.
 * @param versions - its versions
 * @param packageName - its package
 * @param datasource - its datasource
 */
function previousPnpm(
  versions: ToolVersions['versions'],
  packageName = 'pnpm',
  datasource: Source['datasource'] = 'npm',
): ToolVersions {
  return {
    tool: 'pnpm',
    source: { datasource, packageName, versioning: 'npm' },
    updatedAt: '2026-10-07T03:00:00.000Z',
    versions,
  };
}

describe('build', () => {
  let dir: string;
  let archive: string;
  let output: string[];

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tool-versions-'));
    archive = await mkdtemp(join(tmpdir(), 'tool-versions-archive-'));
    // no job summary, unless a test sets one
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
    output = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    nock.cleanAll();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
    await rm(archive, { recursive: true, force: true });
  });

  /**
   * Writes the extracted archive of a release with the previous data of some
   * tools: the slim files and the files of each version.
   * @param previous - the previous data of the tools
   * @returns the folder of the archive
   */
  async function archiveOf(...previous: PreviousToolVersions[]): Promise<string> {
    await mkdir(join(archive, 'v1'), { recursive: true });
    for (const data of previous) {
      const slim = { ...data, versions: data.versions.map(({ files: _files, ...rest }) => rest) };
      await writeFile(join(archive, 'v1', `${data.tool}.json`), JSON.stringify(slim));
      for (const { version, files } of data.versions) {
        if (files) {
          await mkdir(join(archive, 'v1', data.tool), { recursive: true });
          await writeFile(
            join(archive, 'v1', data.tool, `${version}.json`),
            JSON.stringify({ tool: data.tool, version, files }),
          );
        }
      }
    }
    return archive;
  }

  /**
   * Reads the data of a written tool back like the next build does, with the
   * files of its versions.
   * @param tool - the tool name
   */
  async function readBack(tool: string): Promise<PreviousToolVersions | undefined> {
    return await readArchivePrevious(dir, tool);
  }

  /**
   * Reads a written file of the format folder `v1`.
   * @param file - the file name
   */
  async function read(file: string): Promise<string> {
    return await readFile(join(dir, 'v1', file), 'utf8');
  }

  /**
   * The expected index entry of a written tool, with the integrity of the
   * bytes of its files.
   * @param tool - the tool name
   * @param versionCount - the number of its versions
   * @param withFiles - whether the tool has files, so an integrity file
   */
  async function indexEntry(
    tool: string,
    versionCount: number,
    withFiles = false,
  ): Promise<ToolIndex['tools'][number]> {
    const reference = async (file: string): Promise<{ file: string; integrity: string }> => ({
      file,
      integrity: integrity(await read(file)),
    });
    return {
      tool,
      versionCount,
      slim: await reference(`${tool}.json`),
      ...(withFiles && { versionFiles: await reference(`${tool}.integrity.json`) }),
    };
  }

  it('maps only tools known to @containerbase/base', () => {
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(Object.keys(toolSources)));
  });

  it('writes the tools and leaves out failing ones without a previous file', async () => {
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, { versions: { '10.0.0': {}, '9.0.0': {} } })
      .get('/npm')
      .times(3)
      .reply(500)
      .get('/corepack')
      .reply(200, { versions: {} });

    const failed = await build({
      dir,
      sources: {
        ...pnpmSource,
        npm: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
        corepack: { datasource: 'npm', packageName: 'corepack', versioning: 'npm' },
      },
      now,
    });

    expect(failed).toEqual(['npm', 'corepack']);
    // the root has the index of the formats, everything else is in the format folder
    expect((await readdir(dir)).sort()).toEqual(['formats.schema.json', 'index.json', 'v1']);
    expect(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))).toEqual({
      $schema: 'https://containerbase.github.io/tool-versions/formats.schema.json',
      defaultDistro: 'noble',
      formats: [{ version: 1, path: 'v1/', status: 'current' }],
    });
    expect((await readdir(join(dir, 'v1'))).sort()).toEqual([
      'index.json',
      'index.schema.json',
      'integrity.schema.json',
      'pnpm.json',
      'tool.schema.json',
      'version.schema.json',
    ]);
    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      $schema: `${schemas}/tool.schema.json`,
      tool: 'pnpm',
      type: 'npm',
      ...pnpmLinks,
      source: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
      updatedAt: '2026-10-08T12:00:00.000Z',
      versions: [{ version: '10.0.0' }, { version: '9.0.0' }],
    });
    expect(ToolIndex.parse(JSON.parse(await read('index.json')))).toEqual({
      $schema: `${schemas}/index.schema.json`,
      updatedAt: '2026-10-08T12:00:00.000Z',
      tools: [await indexEntry('pnpm', 2)],
    });
    expect(output).toContain(
      '::error::npm: HttpError: GET https://registry.npmjs.org/npm failed with status 500\n',
    );
    expect(output).toContain('::error::corepack: Error: No versions found\n');
  });

  it('writes the previous file when the fetch fails', async () => {
    const previous = previousPnpm([{ version: '9.0.0', lts: true }]);
    nock(registry).get('/pnpm').times(3).reply(500);

    const failed = await build({
      dir,
      sources: pnpmSource,
      now,
      previousArchive: await archiveOf(previous),
    });

    expect(failed).toEqual([]);
    // the previous file gets the current type and links
    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      $schema: `${schemas}/tool.schema.json`,
      ...previous,
      type: 'npm',
      ...pnpmLinks,
    });
    expect(ToolIndex.parse(JSON.parse(await read('index.json')))).toEqual({
      $schema: `${schemas}/index.schema.json`,
      updatedAt: '2026-10-08T12:00:00.000Z',
      tools: [await indexEntry('pnpm', 1)],
    });
    expect(output).toContain(
      '::warning::pnpm: HttpError: GET https://registry.npmjs.org/pnpm failed with status 500, keeping the versions from 2026-10-07T03:00:00.000Z\n',
    );
  });

  it('says which previous state it starts from', async () => {
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, { versions: { '10.0.0': {} } });
    const previousArchive = await archiveOf(previousPnpm([{ version: '9.0.0' }]));

    await build({ dir, sources: pnpmSource, now, previousArchive });

    expect(output).toContain(`previous state: the release archive in ${previousArchive}\n`);
  });

  it('starts empty without an archive, and says so', async () => {
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, { versions: { '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now });

    expect(output).toContain('previous state: none, there is no release archive\n');
    expect(JSON.parse(await read('pnpm.json')).versions).toEqual([{ version: '10.0.0' }]);
  });

  it('keeps a previous file without versioning and writes the current one', async () => {
    const previous = previousPnpm([{ version: '9.0.0' }]);
    nock(registry).get('/pnpm').times(3).reply(500);
    const previousArchive = await archiveOf({
      ...previous,
      source: { datasource: 'npm', packageName: 'pnpm' },
    });

    await expect(build({ dir, sources: pnpmSource, now, previousArchive })).resolves.toEqual([]);

    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      $schema: `${schemas}/tool.schema.json`,
      ...previous,
      type: 'npm',
      ...pnpmLinks,
    });
  });

  it('writes the links after the type', async () => {
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, { versions: { '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now });

    expect(Object.keys(JSON.parse(await read('pnpm.json')))).toEqual([
      '$schema',
      'tool',
      'type',
      'sourceUrl',
      'homepage',
      'source',
      'updatedAt',
      'versions',
    ]);
  });

  it('leaves out an unset link of the republished previous file', async () => {
    const previousArchive = await archiveOf({
      tool: 'java',
      source: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
      updatedAt: '2026-10-07T03:00:00.000Z',
      versions: [
        {
          version: '21.0.5+11.0.LTS',
          files: [
            {
              name: 'a.tar.gz',
              url: 'https://example.com/a.tar.gz',
              checksum: `sha256:${'a'.repeat(64)}`,
            },
          ],
        },
      ],
    });
    nock('https://api.adoptium.net').get('/v3/info/available_releases').times(3).reply(500);

    await build({
      dir,
      sources: {
        java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
      },
      now,
      previousArchive,
    });

    const java = JSON.parse(await read('java.json'));
    expect(java).toMatchObject({ homepage: 'https://adoptium.net' });
    expect(java).not.toHaveProperty('sourceUrl');
  });

  it('merges the fresh versions with the previous ones', async () => {
    const previousArchive = await archiveOf(
      previousPnpm([
        { version: '10.0.0-rc.1', prerelease: true },
        { version: '9.0.0', lts: true },
        { version: '8.0.0' },
      ]),
    );
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, { versions: { '9.0.0': {}, '10.0.0-rc.1': {}, '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now, previousArchive });

    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      $schema: `${schemas}/tool.schema.json`,
      ...previousPnpm([
        { version: '10.0.0' },
        { version: '10.0.0-rc.1', prerelease: true },
        // the fresh flags win
        { version: '9.0.0' },
        // gone upstream, but kept
        { version: '8.0.0' },
      ]),
      type: 'npm',
      ...pnpmLinks,
      updatedAt: '2026-10-08T12:00:00.000Z',
    });
  });

  it('keeps the previous files of a fresh version', async () => {
    const files = [
      {
        name: 'node-v9.0.0-linux-x64.tar.xz',
        url: 'https://nodejs.org/dist/v9.0.0/node-v9.0.0-linux-x64.tar.xz',
        checksum: `sha256:${'a'.repeat(64)}`,
      },
    ];
    // a tool without an installer type, whose source returns no files
    const previousArchive = await archiveOf({
      ...previousPnpm([{ version: '9.0.0', files }], 'node'),
      tool: 'node',
    });
    nock(registry)
      .get('/node')
      .times(2)
      .reply(200, { versions: { '9.0.0': {}, '10.0.0': {} } });

    await build({
      dir,
      sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
      now,
      previousArchive,
    });

    // 10.0.0 has no files and is left out
    expect(await readBack('node')).toMatchObject({
      versions: [{ version: '9.0.0', files }],
    });
    // the slim file has no files, they are in the file of the version, whose
    // integrity is in the integrity file
    const versionFile = await read('node/9.0.0.json');
    expect(JSON.parse(versionFile)).toEqual({
      $schema: `${schemas}/version.schema.json`,
      tool: 'node',
      version: '9.0.0',
      files,
    });
    expect(JSON.parse(await read('node.json')).versions).toEqual([{ version: '9.0.0' }]);
    expect(JSON.parse(await read('node.integrity.json'))).toEqual({
      $schema: `${schemas}/integrity.schema.json`,
      tool: 'node',
      versions: { '9.0.0': integrity(versionFile) },
    });
    expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
      await indexEntry('node', 1, true),
    ]);
  });

  describe('installable versions', () => {
    const sum = `sha512:${'a'.repeat(128)}`;
    const file = (name: string, distro?: string): ToolVersions['versions'][number]['files'] => [
      { name, url: `https://example.com/${name}`, checksum: sum, ...(distro && { distro }) },
    ];

    it('drops the unsupported distro files of the previous file and the versions left empty', async () => {
      const previousArchive = await archiveOf({
        ...previousPnpm(
          [
            { version: '3.0.0', files: file('a.tar.xz', 'bionic') },
            {
              version: '2.0.0',
              files: [...(file('b.tar.xz', 'focal') ?? []), ...(file('c.tar.xz', 'jammy') ?? [])],
            },
            { version: '1.0.0', files: file('d.tar.xz') },
          ],
          'node',
        ),
        tool: 'node',
      });
      nock(registry).get('/node').times(3).reply(500);

      await build({
        dir,
        sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
        now,
        previousArchive,
      });

      expect((await readBack('node'))?.versions).toEqual([
        { version: '2.0.0', files: file('c.tar.xz', 'jammy') },
        { version: '1.0.0', files: file('d.tar.xz') },
      ]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        await indexEntry('node', 2, true),
      ]);
    });

    it('leaves out versions without files when the fetch fails and keeps them for typed tools', async () => {
      const previousArchive = await archiveOf(
        {
          ...previousPnpm(
            [{ version: '2.0.0' }, { version: '1.0.0', files: file('d.tar.xz') }],
            'node',
          ),
          tool: 'node',
        },
        previousPnpm([{ version: '2.0.0' }, { version: '1.0.0' }]),
      );
      nock(registry).get('/node').times(3).reply(500).get('/pnpm').times(3).reply(500);

      await build({
        dir,
        sources: {
          node: { datasource: 'npm', packageName: 'node', versioning: 'node' },
          ...pnpmSource,
        },
        now,
        previousArchive,
      });

      expect((await readBack('node'))?.versions).toEqual([
        { version: '1.0.0', files: file('d.tar.xz') },
      ]);
      expect(JSON.parse(await read('pnpm.json')).versions).toEqual([
        { version: '2.0.0' },
        { version: '1.0.0' },
      ]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        await indexEntry('node', 1, true),
        await indexEntry('pnpm', 2),
      ]);
    });

    it('leaves out a version of the previous file which is not safe in a file name', async () => {
      const previousArchive = await archiveOf({
        ...previousPnpm(
          [
            { version: '2.0.0~rc1', files: file('a.tar.xz') },
            { version: '1.0.0', files: file('b.tar.xz') },
          ],
          'node',
        ),
        tool: 'node',
      });
      nock(registry).get('/node').reply(404);

      await expect(
        build({
          dir,
          sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
          now,
          previousArchive,
        }),
      ).resolves.toEqual([]);

      expect(JSON.parse(await read('node.json')).versions).toEqual([{ version: '1.0.0' }]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        await indexEntry('node', 1, true),
      ]);
      expect(output).toContain(
        '::warning::node: leaving out versions which are not safe in a file name: 2.0.0~rc1\n',
      );
    });

    it('leaves out versions without an amd64 file', async () => {
      const archFile = (arch: 'amd64' | 'arm64'): ToolFile => ({
        name: `${arch}.tar.xz`,
        url: `https://example.com/${arch}.tar.xz`,
        checksum: sum,
        arch,
      });
      const arm = archFile('arm64');
      const amd = archFile('amd64');
      const previousArchive = await archiveOf({
        ...previousPnpm(
          [
            { version: '3.0.0', files: [arm] },
            { version: '2.0.0', files: [amd, arm] },
            { version: '1.0.0', files: file('any.tar.xz') },
          ],
          'node',
        ),
        tool: 'node',
      });
      nock(registry).get('/node').reply(404);

      await build({
        dir,
        sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
        now,
        previousArchive,
      });

      expect((await readBack('node'))?.versions).toEqual([
        { version: '2.0.0', files: [amd, arm] },
        { version: '1.0.0', files: file('any.tar.xz') },
      ]);
    });
  });

  it('omits the type of a tool without one', async () => {
    // a stale type in the previous file is dropped
    const previousArchive = await archiveOf({
      ...previousPnpm([{ version: '9.0.0' }], 'node'),
      tool: 'node',
      type: 'npm',
    });
    nock(registry)
      .get('/node')
      .times(2)
      .reply(200, { versions: { '9.0.0': {} } });

    await build({
      dir,
      sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
      now,
      previousArchive,
    });

    expect(JSON.parse(await read('node.json'))).not.toHaveProperty('type');
  });

  it('keeps the previous release timestamps and adds the ones of new versions', async () => {
    const previousArchive = await archiveOf(
      previousPnpm([
        { version: '10.0.0', releaseTimestamp: '2025-01-01T00:00:00.000Z' },
        { version: '9.0.0', releaseTimestamp: '2024-01-01T00:00:00.000Z' },
        { version: '8.0.0', releaseTimestamp: '2023-01-01T00:00:00.000Z' },
      ]),
    );
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, {
        versions: { '10.0.0': {}, '9.0.0': {}, '8.0.0': {}, '11.0.0': {} },
        time: { '9.0.0': '2024-02-02T00:00:00.000Z', '11.0.0': '2026-01-01T00:00:00.000Z' },
      });

    await build({ dir, sources: pnpmSource, now, previousArchive });

    expect(JSON.parse(await read('pnpm.json')).versions).toEqual([
      { version: '11.0.0', releaseTimestamp: '2026-01-01T00:00:00.000Z' },
      { version: '10.0.0', releaseTimestamp: '2025-01-01T00:00:00.000Z' },
      // the full document is only read for new versions
      { version: '9.0.0', releaseTimestamp: '2024-01-01T00:00:00.000Z' },
      { version: '8.0.0', releaseTimestamp: '2023-01-01T00:00:00.000Z' },
    ]);
  });

  it('gives each tool which computes checksums a fair share of the download budget', async () => {
    // two tools with two files of 8 bytes: the share of each is 15 bytes
    vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '30');
    const github = nock('https://api.github.com');
    const download = nock('https://github.com');
    for (const [repo, name] of [
      ['bazelbuild/bazelisk', 'bazelisk'],
      ['jsonnet-bundler/jsonnet-bundler', 'jb'],
    ] as const) {
      const base = `https://github.com/${repo}/releases/download/v1.0.0`;
      github
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [
          {
            tag_name: 'v1.0.0',
            draft: false,
            prerelease: false,
            assets: ['amd64', 'arm64'].map((arch) => ({
              name: `${name}-linux-${arch}`,
              browser_download_url: `${base}/${name}-linux-${arch}`,
            })),
          },
        ]);
      for (const arch of ['amd64', 'arm64']) {
        download
          .get(`/${repo}/releases/download/v1.0.0/${name}-linux-${arch}`)
          .reply(200, 'x'.repeat(8), { 'content-length': '8' });
      }
    }

    await build({
      dir,
      sources: {
        bazelisk: {
          datasource: 'github-releases',
          packageName: 'bazelbuild/bazelisk',
          versioning: 'semver',
        },
        jb: {
          datasource: 'github-releases',
          packageName: 'jsonnet-bundler/jsonnet-bundler',
          versioning: 'semver',
        },
      },
      now,
    });

    // bazelisk only fits one of its files, and the unused rest goes to jb
    expect((await readBack('jb'))?.versions[0]?.files).toHaveLength(2);
    expect(output.filter((line) => line.startsWith('::notice::'))).toEqual([
      '::notice::bazelbuild/bazelisk: download budget of the tool used up, the checksums of 1 files will be computed by the next builds\n',
    ]);
  });

  it('publishes the files of tools with a file template', async () => {
    const sha = 'e'.repeat(64);
    nock('https://api.github.com')
      .get('/repos/helm/helm/releases')
      .query({ per_page: '100' })
      .reply(200, [{ tag_name: 'v3.19.0', draft: false, prerelease: false }]);
    nock('https://get.helm.sh')
      .get('/helm-v3.19.0-linux-amd64.tar.gz.sha256sum')
      .reply(200, `${sha}  helm-v3.19.0-linux-amd64.tar.gz\n`)
      .get('/helm-v3.19.0-linux-arm64.tar.gz.sha256sum')
      .reply(404)
      // older releases only have the bare digest
      .get('/helm-v3.19.0-linux-arm64.tar.gz.sha256')
      .reply(200, sha.toUpperCase());

    await build({
      dir,
      sources: {
        helm: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
      },
      now,
    });

    expect(await readBack('helm')).toMatchObject({
      versions: [
        {
          version: '3.19.0',
          files: [
            {
              name: 'helm-v3.19.0-linux-amd64.tar.gz',
              url: 'https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz',
              checksum: `sha256:${sha}`,
              arch: 'amd64',
            },
            {
              name: 'helm-v3.19.0-linux-arm64.tar.gz',
              url: 'https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz',
              checksum: `sha256:${sha}`,
              arch: 'arm64',
            },
          ],
        },
      ],
    });
  });

  describe('minimum version', () => {
    const helm: Source = {
      datasource: 'github-releases',
      packageName: 'helm/helm',
      versioning: 'semver',
    };
    const helmSource = { helm };
    const sha = 'e'.repeat(64);

    /**
     * A file of a helm version.
     * @param version - the version
     */
    function helmFile(version: string): ToolFile {
      const name = `helm-v${version}-linux-amd64.tar.gz`;
      return { name, url: `https://get.helm.sh/${name}`, checksum: `sha256:${sha}`, arch: 'amd64' };
    }

    it('leaves out the versions older than the minimum and does not fetch their files', async () => {
      nock('https://api.github.com')
        .get('/repos/helm/helm/releases')
        .query({ per_page: '100' })
        .reply(200, [
          { tag_name: 'v3.19.0', draft: false, prerelease: false },
          { tag_name: 'v3.0.2', draft: false, prerelease: false },
        ]);
      // an unmocked request of the files of 3.0.2 would warn
      nock('https://get.helm.sh')
        .get('/helm-v3.19.0-linux-amd64.tar.gz.sha256sum')
        .reply(200, `${sha}  helm-v3.19.0-linux-amd64.tar.gz\n`)
        .get('/helm-v3.19.0-linux-arm64.tar.gz.sha256sum')
        .reply(404)
        .get('/helm-v3.19.0-linux-arm64.tar.gz.sha256')
        .reply(404);

      await build({ dir, sources: helmSource, now });

      expect(JSON.parse(await read('helm.json')).versions).toEqual([{ version: '3.19.0' }]);
      expect(await readdir(join(dir, 'v1', 'helm'))).toEqual(['3.19.0.json']);
      expect(output.filter((line) => line.startsWith('::warning::'))).toEqual([]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        await indexEntry('helm', 1, true),
      ]);
    });

    it('drops the versions of the previous file which are older than the minimum', async () => {
      const previous: ToolVersions = {
        tool: 'helm',
        source: helm,
        updatedAt: '2026-10-07T03:00:00.000Z',
        versions: [
          { version: '3.2.0', files: [helmFile('3.2.0')] },
          { version: '3.0.2', files: [helmFile('3.0.2')] },
        ],
      };
      const previousArchive = await archiveOf(previous);
      nock('https://api.github.com')
        .get('/repos/helm/helm/releases')
        .query({ per_page: '100' })
        .times(3)
        .reply(500);

      await expect(build({ dir, sources: helmSource, now, previousArchive })).resolves.toEqual([]);

      expect((await readBack('helm'))?.versions).toEqual([
        { version: '3.2.0', files: [helmFile('3.2.0')] },
      ]);
      expect(await readdir(join(dir, 'v1', 'helm'))).toEqual(['3.2.0.json']);
    });

    it('publishes the minimum versions and leaves out the files below the minimum of a distro', async () => {
      const distroSource: Source = {
        datasource: 'github-releases',
        packageName: 'example/distro-test',
        versioning: 'semver',
      };
      const file = (name: string, distro?: string): ToolFile => ({
        name,
        url: `https://example.com/${name}`,
        checksum: `sha256:${sha}`,
        arch: 'amd64',
        ...(distro && { distro }),
      });
      const previous: ToolVersions = {
        tool: 'distro-test',
        // a stale minimum is replaced by the current one
        minVersion: '0.1.0',
        source: distroSource,
        updatedAt: '2026-10-07T03:00:00.000Z',
        versions: [
          {
            version: '2.1.0',
            files: [file('a-2.1.0.tgz'), file('a-2.1.0-resolute.tgz', 'resolute')],
          },
          {
            version: '1.5.0',
            files: [file('a-1.5.0.tgz'), file('a-1.5.0-resolute.tgz', 'resolute')],
          },
          // below the minimum
          { version: '0.9.0', files: [file('a-0.9.0.tgz')] },
        ],
      };
      const previousArchive = await archiveOf(previous);
      nock('https://api.github.com')
        .get('/repos/example/distro-test/releases')
        .query({ per_page: '100' })
        .times(3)
        .reply(500);

      await build({ dir, sources: { 'distro-test': distroSource }, now, previousArchive });

      const slim = JSON.parse(await read('distro-test.json'));
      expect(Object.keys(slim).slice(0, 4)).toEqual([
        '$schema',
        'tool',
        'minVersion',
        'distroMinVersion',
      ]);
      expect(slim).toMatchObject({ minVersion: '1.0.0', distroMinVersion: { resolute: '2.0.0' } });
      expect(slim.versions).toEqual([{ version: '2.1.0' }, { version: '1.5.0' }]);
      // 1.5.0 has no resolute file, 2.1.0 keeps it
      expect((await readBack('distro-test'))?.versions).toEqual([
        {
          version: '2.1.0',
          files: [file('a-2.1.0.tgz'), file('a-2.1.0-resolute.tgz', 'resolute')],
        },
        { version: '1.5.0', files: [file('a-1.5.0.tgz')] },
      ]);
    });

    it('warns for a minimum which is no valid version of the versioning of the tool', async () => {
      // `min-test` has the minimum 18.09.0 in the mocked metadata, which has a
      // leading zero that semver doesn't allow
      nock('https://api.github.com')
        .get('/repos/example/min-test/releases')
        .query({ per_page: '100' })
        .times(3)
        .reply(500);

      await build({
        dir,
        sources: {
          'min-test': {
            datasource: 'github-releases',
            packageName: 'example/min-test',
            versioning: 'semver',
          },
        },
        now,
      });

      expect(output).toContain(
        '::warning::min-test: the minimum version 18.09.0 is not a valid semver version, no versions are left out\n',
      );
    });

    it('has a minimum which fits the versioning of each mapped tool', () => {
      const metadata: Record<string, ToolMetadata> = tools;
      const invalid = Object.entries(toolSources)
        .filter(([tool, { versioning }]) => {
          const minVersion = metadata[tool]?.minVersion;
          return minVersion !== undefined && !versionings[versioning].isValid(minVersion);
        })
        .map(([tool]) => tool);

      expect(invalid).toEqual([]);
    });
  });

  it('publishes no files for a tool with an installer type', async () => {
    const sha = 'f'.repeat(128);
    const dl = 'https://github.com/pnpm/pnpm/releases/download/v10.0.0';
    const previousArchive = await archiveOf(
      previousPnpm(
        [
          {
            version: '9.0.0',
            files: [{ name: 'a.tgz', url: 'https://example.com/a.tgz', checksum: `sha512:${sha}` }],
          },
        ],
        'pnpm/pnpm',
        'github-releases',
      ),
    );
    nock('https://api.github.com')
      .get('/repos/pnpm/pnpm/releases')
      .query({ per_page: '100' })
      .reply(200, [
        {
          tag_name: 'v10.0.0',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'pnpm.tgz', browser_download_url: `${dl}/pnpm.tgz` },
            { name: 'pnpm.tgz.sha512', browser_download_url: `${dl}/pnpm.tgz.sha512` },
          ],
        },
      ]);
    // no request to the sidecar is mocked, so it would fail and print a warning

    await build({
      dir,
      sources: {
        pnpm: { datasource: 'github-releases', packageName: 'pnpm/pnpm', versioning: 'npm' },
      },
      now,
      previousArchive,
    });

    expect(JSON.parse(await read('pnpm.json'))).toMatchObject({
      versions: [{ version: '10.0.0' }, { version: '9.0.0' }],
    });
    expect(await read('pnpm.json')).not.toContain('files');
    expect(output.filter((line) => line.startsWith('::warning'))).toEqual([]);
  });

  describe('job summary', () => {
    /** The previous file of the `npm` tool, which has one version. */
    const previousNpm: ToolVersions = {
      tool: 'npm',
      source: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
      updatedAt: '2026-10-07T03:00:00.000Z',
      versions: [{ version: '10.0.0' }],
    };

    it('writes the summary of a build with an updated, a kept and a failed tool', async () => {
      const summary = join(dir, 'summary.md');
      vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
      const previousArchive = await archiveOf(previousPnpm([{ version: '9.0.0' }]), previousNpm);
      nock(registry)
        .get('/pnpm')
        .times(2)
        .reply(200, { versions: { '9.0.0': {}, '10.0.0': {} } })
        .get('/npm')
        .times(3)
        .reply(500)
        .get('/corepack')
        .times(3)
        .reply(500);
      const times = [1000, 13_000];

      await build({
        dir,
        sources: {
          pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
          npm: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
          corepack: { datasource: 'npm', packageName: 'corepack', versioning: 'npm' },
        },
        now,
        clock: () => times.shift() ?? 0,
        previousArchive,
      });

      expect(await readFile(summary, 'utf8')).toBe(
        [
          '## Build summary',
          '',
          'Incremental build in 12 s. Tools updated: 1, kept previous: 1, failed: 1. Versions: 3.',
          '',
          '### Download budget',
          '',
          'Budget: 3.0 GiB, used: 0 B. Computed checksums: 0, waiting for the next builds: 0.',
          '',
          '### Tools',
          '',
          '| Tool | Status | Versions | New | Files added | Computed | Warnings |',
          '| --- | --- | ---: | ---: | ---: | --- | ---: |',
          '| corepack | failed | 0 | 0 | 0 | – | 1 |',
          '| npm | kept previous | 1 | 0 | 0 | – | 1 |',
          '| pnpm | updated | 2 | 1 | 0 | – | 0 |',
          '',
          '### Warnings and errors',
          '',
          '<details><summary>corepack: 1 message</summary>',
          '',
          '- **error** corepack: HttpError: GET https://registry.npmjs.org/corepack failed with status 500',
          '',
          '</details>',
          '',
          '<details><summary>npm: 1 message</summary>',
          '',
          '- **warning** npm: HttpError: GET https://registry.npmjs.org/npm failed with status 500, keeping the versions from 2026-10-07T03:00:00.000Z',
          '',
          '</details>',
          '',
        ].join('\n'),
      );
      // the log lines are written as before
      expect(output).toContain(
        '::error::corepack: HttpError: GET https://registry.npmjs.org/corepack failed with status 500\n',
      );
    });

    it('writes no summary without GITHUB_STEP_SUMMARY', async () => {
      nock(registry)
        .get('/pnpm')
        .times(2)
        .reply(200, { versions: { '9.0.0': {} } });

      await build({ dir, sources: pnpmSource, now });

      expect(await readdir(dir)).not.toContain('summary.md');
    });
  });

  it('ignores a previous file of another source', async () => {
    const previousArchive = await archiveOf(previousPnpm([{ version: '1.0.0' }], 'other'));
    nock(registry).get('/pnpm').times(3).reply(500);

    await expect(build({ dir, sources: pnpmSource, now, previousArchive })).resolves.toEqual([
      'pnpm',
    ]);
  });

  it('skips the previous state in full mode', async () => {
    const previousArchive = await archiveOf(previousPnpm([{ version: '8.0.0' }]));
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, { versions: { '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now, full: true, previousArchive });

    // 8.0.0 would be kept, as it is gone upstream
    expect(JSON.parse(await read('pnpm.json')).versions).toEqual([{ version: '10.0.0' }]);
  });

  it('fails for a tool unknown to @containerbase/base', async () => {
    await expect(
      build({
        dir,
        sources: {
          ...pnpmSource,
          'not-a-tool': { datasource: 'npm', packageName: 'not-a-tool', versioning: 'npm' },
        },
        now,
      }),
    ).rejects.toThrow('Tools not found in @containerbase/base: not-a-tool');
    expect(await readdir(dir)).toEqual([]);
  });
});
