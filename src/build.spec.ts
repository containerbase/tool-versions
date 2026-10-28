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
  type ToolSource,
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
    // the previous file gets the current type, links and lts flag
    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      $schema: `${schemas}/tool.schema.json`,
      ...previous,
      type: 'npm',
      ...pnpmLinks,
      lts: true,
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
      'updatedAt',
      'versions',
      'source',
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

  it('flags a tool with an LTS release as lts', async () => {
    const file = {
      name: 'a.tar.gz',
      url: 'https://example.com/a.tar.gz',
      checksum: `sha256:${'a'.repeat(64)}`,
    };
    const previousArchive = await archiveOf({
      tool: 'java',
      source: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
      updatedAt: '2026-10-07T03:00:00.000Z',
      versions: [
        { version: '22.0.2+9', files: [file] },
        { version: '21.0.5+11.0.LTS', lts: true, files: [file] },
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

    expect(JSON.parse(await read('java.json'))).toMatchObject({ lts: true });
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

  it('drops the rust nightlies older than 90 days from the previous file', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const rustSource: Source = {
      datasource: 'rust-version',
      packageName: 'rust-lang/rust',
      versioning: 'rust-release-channel',
    };
    const files = (version: string): ToolVersions['versions'][number]['files'] => [
      {
        name: 'rust-nightly-x86_64-unknown-linux-gnu.tar.xz',
        url: `https://static.rust-lang.org/dist/${version}/rust-nightly-x86_64-unknown-linux-gnu.tar.xz`,
        checksum: `sha256:${'a'.repeat(64)}`,
        arch: 'amd64',
      },
    ];
    const previousArchive = await archiveOf({
      tool: 'rust',
      source: rustSource,
      updatedAt: '2026-10-07T03:00:00.000Z',
      versions: [
        { version: 'nightly-2026-09-01', prerelease: true, files: files('2026-09-01') },
        { version: 'nightly-2026-06-01', prerelease: true, files: files('2026-06-01') },
        { version: '1.89.0', files: files('2026-06-01') },
      ],
    });
    nock('https://api.github.com')
      .get('/repos/rust-lang/rust/releases')
      .query({ per_page: '100' })
      .reply(200, []);
    nock('https://static.rust-lang.org').get('/manifests.txt').reply(200, '');

    try {
      await build({ dir, sources: { rust: rustSource }, now, previousArchive });
    } finally {
      vi.useRealTimers();
    }

    expect((await readBack('rust'))?.versions.map(({ version }) => version)).toEqual([
      'nightly-2026-09-01',
      '1.89.0',
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
            { version: '30.0.0', files: file('a.tar.xz', 'bionic') },
            {
              version: '20.0.0',
              files: [...(file('b.tar.xz', 'focal') ?? []), ...(file('c.tar.xz', 'jammy') ?? [])],
            },
            { version: '10.0.0', files: file('d.tar.xz') },
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
        { version: '20.0.0', files: file('c.tar.xz', 'jammy') },
        { version: '10.0.0', files: file('d.tar.xz') },
      ]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        await indexEntry('node', 2, true),
      ]);
    });

    it('leaves out versions without files when the fetch fails and keeps them for typed tools', async () => {
      const previousArchive = await archiveOf(
        {
          ...previousPnpm(
            [{ version: '20.0.0' }, { version: '10.0.0', files: file('d.tar.xz') }],
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
        { version: '10.0.0', files: file('d.tar.xz') },
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
            { version: '20.0.0~rc1', files: file('a.tar.xz') },
            { version: '10.0.0', files: file('b.tar.xz') },
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

      expect(JSON.parse(await read('node.json')).versions).toEqual([{ version: '10.0.0' }]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        await indexEntry('node', 1, true),
      ]);
      expect(output).toContain(
        '::warning::node: leaving out versions which are not safe in a file name: 20.0.0~rc1\n',
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
            { version: '30.0.0', files: [arm] },
            { version: '20.0.0', files: [amd, arm] },
            { version: '10.0.0', files: file('any.tar.xz') },
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
        { version: '20.0.0', files: [amd, arm] },
        { version: '10.0.0', files: file('any.tar.xz') },
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

  it('keeps the previous constraints and takes fresh ones for versions without any', async () => {
    const previousArchive = await archiveOf(
      previousPnpm([
        { version: '10.0.0', constraints: { node: '>=18' } },
        { version: '9.0.0', constraints: { node: '>=16' } },
        { version: '8.0.0', constraints: { node: '>=14' } },
        { version: '7.0.0' },
      ]),
    );
    nock(registry)
      .get('/pnpm')
      .times(2)
      .reply(200, {
        versions: {
          '11.0.0': { engines: { node: '>=20' } },
          '10.0.0': { engines: { node: '>=20.1' } },
          '9.0.0': {},
          '7.0.0': { engines: { node: '>=12' } },
        },
        time: {},
      });

    await build({ dir, sources: pnpmSource, now, previousArchive });

    expect(JSON.parse(await read('pnpm.json')).versions).toEqual([
      { version: '11.0.0', constraints: { node: '>=20' } },
      // a changed or missing registry value doesn't replace the previous one
      { version: '10.0.0', constraints: { node: '>=18' } },
      { version: '9.0.0', constraints: { node: '>=16' } },
      { version: '8.0.0', constraints: { node: '>=14' } },
      { version: '7.0.0', constraints: { node: '>=12' } },
    ]);
  });

  it('gives each tool which computes checksums a fair share of the download budget', async () => {
    // two tools with two files of 8 bytes: the share of each is 15 bytes
    vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '30');
    const github = nock('https://api.github.com');
    const download = nock('https://github.com');
    for (const [repo, tag, names] of [
      ['bazelbuild/bazelisk', 'v1.0.0', ['bazelisk-linux-amd64', 'bazelisk-linux-arm64']],
      [
        'protocolbuffers/protobuf',
        'v25.1',
        ['protoc-25.1-linux-x86_64.zip', 'protoc-25.1-linux-aarch_64.zip'],
      ],
    ] as const) {
      const base = `https://github.com/${repo}/releases/download/${tag}`;
      github
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [
          {
            tag_name: tag,
            draft: false,
            prerelease: false,
            assets: names.map((name) => ({
              name,
              browser_download_url: `${base}/${name}`,
            })),
          },
        ]);
      for (const name of names) {
        download
          .get(`/${repo}/releases/download/${tag}/${name}`)
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
        protoc: {
          datasource: 'github-releases',
          packageName: 'protocolbuffers/protobuf',
          versioning: 'docker',
        },
      },
      now,
    });

    // bazelisk only fits one of its files, and the unused rest goes to protoc
    expect((await readBack('protoc'))?.versions[0]?.files).toHaveLength(2);
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

      // the arm64 file has no checksum yet
      expect(JSON.parse(await read('helm.json')).versions).toEqual([
        { version: '3.19.0', archs: ['amd64'] },
      ]);
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
      expect(slim.versions).toEqual([
        { version: '2.1.0', archs: ['amd64'], distros: ['resolute'] },
        { version: '1.5.0', archs: ['amd64'] },
      ]);
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

  describe('minCb', () => {
    const minCbSource: ToolSource = {
      datasource: 'github-releases',
      packageName: 'example/distro-test',
      versioning: 'semver',
      minCb: [
        { from: '2.0.0', cb: '14.0.0' },
        { from: '3.0.0', cb: '15.1.0' },
      ],
    };

    /**
     * Builds `distro-test` from a previous file, as the fetch fails.
     * @param source - the source of the tool
     * @param versions - the versions of the previous file, in its order
     * @param previousMinCb - the ranges of the previous file, a stale one by default
     */
    async function buildMinCb(
      source: ToolSource,
      versions = ['3.1.0', '3.0.0', '3.0.0-rc.1', '2.5.0', '2.0.0', '1.5.0'],
      previousMinCb = [{ version: '1.5.0', cb: '9.9.9' }],
    ): Promise<void> {
      const previous: ToolVersions = {
        tool: 'distro-test',
        source: {
          datasource: 'github-releases',
          packageName: 'example/distro-test',
          versioning: 'semver',
        },
        updatedAt: '2026-10-07T03:00:00.000Z',
        // a stale range of the previous file is replaced
        minCb: previousMinCb,
        versions: versions
          .map((version) => ({ version }))
          .map((entry) => ({
            ...entry,
            files: [
              {
                name: `a-${entry.version}.tgz`,
                url: `https://example.com/a-${entry.version}.tgz`,
                checksum: `sha256:${'e'.repeat(64)}`,
                arch: 'amd64' as const,
              },
            ],
          })),
      };
      const previousArchive = await archiveOf(previous);
      nock('https://api.github.com')
        .get('/repos/example/distro-test/releases')
        .query({ per_page: '100' })
        .times(3)
        .reply(500);

      await build({ dir, sources: { 'distro-test': source }, now, previousArchive });
    }

    /**
     * Builds `distro-test` with some ranges and reads the published ranges.
     * @param minCb - the configured ranges
     */
    async function publishedMinCb(minCb: ToolSource['minCb']): Promise<unknown> {
      await buildMinCb({ ...minCbSource, minCb });
      return JSON.parse(await read('distro-test.json')).minCb;
    }

    it('resolves the ranges to the oldest published version, newest first', async () => {
      // 3.0.0-rc.1 is the first release of the new scheme, 2.0.0 is published
      expect(
        await publishedMinCb([
          { from: '2.0.0', cb: '14.0.0' },
          { from: '3.0.0-rc.1', cb: '15.1.0' },
        ]),
      ).toEqual([
        { version: '3.0.0-rc.1', cb: '15.1.0' },
        { version: '2.0.0', cb: '14.0.0' },
      ]);
    });

    it('resolves a range which starts before a published version to the next one', async () => {
      expect(await publishedMinCb([{ from: '2.2.0', cb: '14.0.0' }])).toEqual([
        { version: '2.5.0', cb: '14.0.0' },
      ]);
    });

    it('starts the range of a release after its prereleases', async () => {
      expect(await publishedMinCb([{ from: '3.0.0', cb: '14.0.0' }])).toEqual([
        { version: '3.0.0', cb: '14.0.0' },
      ]);
    });

    it('starts the range at the lowest listed of versions which compare equal', async () => {
      // maven versions have missing numbers count as 0, so `1.0` and `1.0.0` are equal
      await buildMinCb(
        {
          ...minCbSource,
          versioning: 'maven',
          minCb: [{ from: '1.0', cb: '14.0.0' }],
        },
        ['1.1', '1.0', '1.0.0', '0.9'],
      );

      expect(JSON.parse(await read('distro-test.json')).minCb).toEqual([
        { version: '1.0.0', cb: '14.0.0' },
      ]);
    });

    const invalidWarning =
      '::warning::distro-test: not every version is a valid docker version, keeping the previous minCb ranges\n';

    it('keeps the previous order and ranges for versions which are invalid in the versioning', async () => {
      // `1.2.x` is no docker version, the range of `0.1.0` is no longer listed
      await buildMinCb(
        { ...minCbSource, versioning: 'docker', minCb: [{ from: '1.0', cb: '14.0.0' }] },
        ['1.5.0', '1.2.x'],
        [
          { version: '1.5.0', cb: '9.9.9' },
          { version: '0.1.0', cb: '9.0.0' },
        ],
      );

      const published = JSON.parse(await read('distro-test.json'));
      expect(published.versions.map(({ version }: { version: string }) => version)).toEqual([
        '1.5.0',
        '1.2.x',
      ]);
      expect(published.minCb).toEqual([{ version: '1.5.0', cb: '9.9.9' }]);
      expect(output).toContain(invalidWarning);
    });

    it('keeps the previous ranges for a single invalid version', async () => {
      await buildMinCb(
        { ...minCbSource, versioning: 'docker', minCb: [{ from: '1.0', cb: '14.0.0' }] },
        ['1.2.x'],
        [{ version: '1.2.x', cb: '9.9.9' }],
      );

      expect(JSON.parse(await read('distro-test.json')).minCb).toEqual([
        { version: '1.2.x', cb: '9.9.9' },
      ]);
      expect(output).toContain(invalidWarning);
    });

    it('keeps the previous order and ranges for an invalid maven version', async () => {
      // `latest` is no maven version, it would sort below `1.0`
      await buildMinCb(
        { ...minCbSource, versioning: 'maven', minCb: [{ from: '1.0', cb: '14.0.0' }] },
        ['latest', '1.0'],
        [{ version: '1.0', cb: '9.9.9' }],
      );

      const published = JSON.parse(await read('distro-test.json'));
      expect(published.versions.map(({ version }: { version: string }) => version)).toEqual([
        'latest',
        '1.0',
      ]);
      expect(published.minCb).toEqual([{ version: '1.0', cb: '9.9.9' }]);
    });

    it('sorts the kept versions with the current versioning before resolving the ranges', async () => {
      await buildMinCb({ ...minCbSource, minCb: [{ from: '2.0.0', cb: '14.0.0' }] }, [
        '2.0.0',
        '3.0.0',
        '1.5.0',
      ]);

      const published = JSON.parse(await read('distro-test.json'));
      expect(published.versions.map(({ version }: { version: string }) => version)).toEqual([
        '3.0.0',
        '2.0.0',
        '1.5.0',
      ]);
      expect(published.minCb).toEqual([{ version: '2.0.0', cb: '14.0.0' }]);
    });

    it('leaves out a range without a published version yet, and the stale ranges', async () => {
      await buildMinCb({ ...minCbSource, minCb: [{ from: '9.0.0', cb: '20.0.0' }] });

      expect(JSON.parse(await read('distro-test.json'))).not.toHaveProperty('minCb');
    });

    it('publishes no minCb on the versions', async () => {
      await buildMinCb(minCbSource);

      const { versions } = JSON.parse(await read('distro-test.json'));
      expect(versions).toHaveLength(6);
      expect(versions.some((version: object) => 'minCb' in version)).toBe(false);
    });

    it('does not publish the ranges in the source', async () => {
      await buildMinCb(minCbSource);

      expect(JSON.parse(await read('distro-test.json')).source).toEqual({
        datasource: 'github-releases',
        packageName: 'example/distro-test',
        versioning: 'semver',
      });
    });

    it('removes the stale ranges of a tool without ranges', async () => {
      await buildMinCb({ ...minCbSource, minCb: [] });

      expect(JSON.parse(await read('distro-test.json'))).not.toHaveProperty('minCb');
    });

    it.each([
      [
        [{ from: 'latest', cb: '14.0.0' }],
        'distro-test: minCb from latest is not a valid semver version',
      ],
      [[{ from: '2.0.0', cb: '14' }], 'distro-test: minCb 14 is not a valid semver version'],
      [
        [{ from: '2.0.0', cb: 'v14.51.0' }],
        'distro-test: minCb v14.51.0 is not a valid semver version',
      ],
      [
        [
          { from: '2.0.0', cb: '14.0.0' },
          { from: '2.0.0', cb: '15.0.0' },
        ],
        'distro-test: minCb from 2.0.0 is listed more than once',
      ],
      [
        [
          { from: '3.0.0', cb: '14.0.0' },
          { from: '2.0.0', cb: '15.0.0' },
        ],
        'distro-test: minCb 14.0.0 from 3.0.0 is older than 15.0.0 from 2.0.0',
      ],
    ])('throws for an invalid range', async (minCb, message) => {
      await expect(
        build({ dir, sources: { 'distro-test': { ...minCbSource, minCb } }, now }),
      ).rejects.toThrow(message);
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
