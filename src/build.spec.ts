import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { tools } from '@containerbase/base';
import nock from 'nock';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from './build.ts';
import { type Source, ToolIndex, type ToolVersions } from './schema.ts';
import { toolSources } from './tools.ts';

const now = new Date('2026-10-08T12:00:00.000Z');
const pages = 'https://pages.example.com';
const registry = 'https://registry.npmjs.org';
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
  let output: string[];

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tool-versions-'));
    vi.stubEnv('TOOL_VERSIONS_URL', pages);
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
  });

  /**
   * Reads a written file of the output folder.
   * @param file - the file name
   */
  async function read(file: string): Promise<string> {
    return await readFile(join(dir, file), 'utf8');
  }

  it('maps only tools known to @containerbase/base', () => {
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(Object.keys(toolSources)));
  });

  it('writes the tools and leaves out failing ones without a previous file', async () => {
    nock(pages)
      .get('/pnpm.json')
      .reply(404)
      .get('/npm.json')
      .reply(404)
      .get('/corepack.json')
      .reply(404);
    nock(registry)
      .get('/pnpm')
      .reply(200, { versions: { '10.0.0': {}, '9.0.0': {} } })
      .get('/npm')
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
    expect((await readdir(dir)).sort()).toEqual([
      'index.json',
      'index.json.sha512',
      'index.schema.json',
      'index.schema.json.sha512',
      'pnpm.json',
      'pnpm.json.sha512',
      'tool.schema.json',
      'tool.schema.json.sha512',
    ]);
    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      tool: 'pnpm',
      type: 'npm',
      source: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
      updatedAt: '2026-10-08T12:00:00.000Z',
      versions: [{ version: '10.0.0' }, { version: '9.0.0' }],
    });
    expect(ToolIndex.parse(JSON.parse(await read('index.json')))).toEqual({
      updatedAt: '2026-10-08T12:00:00.000Z',
      tools: [{ tool: 'pnpm', file: 'pnpm.json', versionCount: 2 }],
    });
    expect(output).toContain(
      '::error::npm: HttpError: GET https://registry.npmjs.org/npm failed with status 500\n',
    );
    expect(output).toContain('::error::corepack: Error: No versions found\n');
  });

  it('writes the previous file when the fetch fails', async () => {
    const previous = previousPnpm([{ version: '9.0.0', lts: true }]);
    nock(pages).get('/pnpm.json').reply(200, previous);
    nock(registry).get('/pnpm').reply(500);

    const failed = await build({ dir, sources: pnpmSource, now });

    expect(failed).toEqual([]);
    // the previous file gets the current type
    expect(JSON.parse(await read('pnpm.json'))).toEqual({ ...previous, type: 'npm' });
    expect(ToolIndex.parse(JSON.parse(await read('index.json')))).toEqual({
      updatedAt: '2026-10-08T12:00:00.000Z',
      tools: [{ tool: 'pnpm', file: 'pnpm.json', versionCount: 1 }],
    });
    expect(output).toContain(
      '::warning::pnpm: HttpError: GET https://registry.npmjs.org/pnpm failed with status 500, keeping the versions from 2026-10-07T03:00:00.000Z\n',
    );
  });

  it('keeps a previous file without versioning and writes the current one', async () => {
    const previous = previousPnpm([{ version: '9.0.0' }]);
    nock(pages)
      .get('/pnpm.json')
      .reply(200, { ...previous, source: { datasource: 'npm', packageName: 'pnpm' } });
    nock(registry).get('/pnpm').reply(500);

    await expect(build({ dir, sources: pnpmSource, now })).resolves.toEqual([]);

    expect(JSON.parse(await read('pnpm.json'))).toEqual({ ...previous, type: 'npm' });
  });

  it('merges the fresh versions with the previous ones', async () => {
    nock(pages)
      .get('/pnpm.json')
      .reply(
        200,
        previousPnpm([
          { version: '10.0.0-rc.1', prerelease: true },
          { version: '9.0.0', lts: true },
          { version: '8.0.0' },
        ]),
      );
    nock(registry)
      .get('/pnpm')
      .reply(200, { versions: { '9.0.0': {}, '10.0.0-rc.1': {}, '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now });

    expect(JSON.parse(await read('pnpm.json'))).toEqual({
      ...previousPnpm([
        { version: '10.0.0' },
        { version: '10.0.0-rc.1', prerelease: true },
        // the fresh flags win
        { version: '9.0.0' },
        // gone upstream, but kept
        { version: '8.0.0' },
      ]),
      type: 'npm',
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
    nock(pages)
      .get('/node.json')
      .reply(200, {
        ...previousPnpm([{ version: '9.0.0', files }], 'node'),
        tool: 'node',
      });
    nock(registry)
      .get('/node')
      .reply(200, { versions: { '9.0.0': {}, '10.0.0': {} } });

    await build({
      dir,
      sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
      now,
    });

    // 10.0.0 has no files and is left out
    expect(JSON.parse(await read('node.json'))).toMatchObject({
      versions: [{ version: '9.0.0', files }],
    });
    expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
      { tool: 'node', file: 'node.json', versionCount: 1 },
    ]);
  });

  describe('installable versions', () => {
    const sum = `sha512:${'a'.repeat(128)}`;
    const file = (name: string, distro?: string): ToolVersions['versions'][number]['files'] => [
      { name, url: `https://example.com/${name}`, checksum: sum, ...(distro && { distro }) },
    ];

    it('drops the unsupported distro files of the previous file and the versions left empty', async () => {
      nock(pages)
        .get('/node.json')
        .reply(200, {
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
      nock(registry).get('/node').reply(500);

      await build({
        dir,
        sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
        now,
      });

      expect(JSON.parse(await read('node.json')).versions).toEqual([
        { version: '2.0.0', files: file('c.tar.xz', 'jammy') },
        { version: '1.0.0', files: file('d.tar.xz') },
      ]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        { tool: 'node', file: 'node.json', versionCount: 2 },
      ]);
    });

    it('leaves out versions without files when the fetch fails and keeps them for typed tools', async () => {
      nock(pages)
        .get('/node.json')
        .reply(200, {
          ...previousPnpm(
            [{ version: '2.0.0' }, { version: '1.0.0', files: file('d.tar.xz') }],
            'node',
          ),
          tool: 'node',
        })
        .get('/pnpm.json')
        .reply(200, previousPnpm([{ version: '2.0.0' }, { version: '1.0.0' }]));
      nock(registry).get('/node').reply(500).get('/pnpm').reply(500);

      await build({
        dir,
        sources: {
          node: { datasource: 'npm', packageName: 'node', versioning: 'node' },
          ...pnpmSource,
        },
        now,
      });

      expect(JSON.parse(await read('node.json')).versions).toEqual([
        { version: '1.0.0', files: file('d.tar.xz') },
      ]);
      expect(JSON.parse(await read('pnpm.json')).versions).toEqual([
        { version: '2.0.0' },
        { version: '1.0.0' },
      ]);
      expect(ToolIndex.parse(JSON.parse(await read('index.json'))).tools).toEqual([
        { tool: 'node', file: 'node.json', versionCount: 1 },
        { tool: 'pnpm', file: 'pnpm.json', versionCount: 2 },
      ]);
    });
  });

  it('omits the type of a tool without one', async () => {
    // a stale type in the previous file is dropped
    nock(pages)
      .get('/node.json')
      .reply(200, {
        ...previousPnpm([{ version: '9.0.0' }], 'node'),
        tool: 'node',
        type: 'npm',
      });
    nock(registry)
      .get('/node')
      .reply(200, { versions: { '9.0.0': {} } });

    await build({
      dir,
      sources: { node: { datasource: 'npm', packageName: 'node', versioning: 'node' } },
      now,
    });

    expect(JSON.parse(await read('node.json'))).not.toHaveProperty('type');
  });

  it('publishes the files of tools with a file template', async () => {
    const sha = 'e'.repeat(64);
    nock(pages).get('/helm.json').reply(404);
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

    expect(JSON.parse(await read('helm.json'))).toMatchObject({
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

  it('publishes no files for a tool with an installer type', async () => {
    const sha = 'f'.repeat(128);
    const dl = 'https://github.com/pnpm/pnpm/releases/download/v10.0.0';
    nock(pages)
      .get('/pnpm.json')
      .reply(
        200,
        previousPnpm(
          [
            {
              version: '9.0.0',
              files: [
                { name: 'a.tgz', url: 'https://example.com/a.tgz', checksum: `sha512:${sha}` },
              ],
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
    });

    expect(JSON.parse(await read('pnpm.json'))).toMatchObject({
      versions: [{ version: '10.0.0' }, { version: '9.0.0' }],
    });
    expect(await read('pnpm.json')).not.toContain('files');
    expect(output.filter((line) => line.startsWith('::warning'))).toEqual([]);
  });

  it('ignores a previous file of another source', async () => {
    nock(pages)
      .get('/pnpm.json')
      .reply(200, previousPnpm([{ version: '1.0.0' }], 'other'));
    nock(registry).get('/pnpm').reply(500);

    await expect(build({ dir, sources: pnpmSource, now })).resolves.toEqual(['pnpm']);
  });

  it('skips the previous files in full mode', async () => {
    const scope = nock(pages)
      .get('/pnpm.json')
      .reply(200, previousPnpm([{ version: '8.0.0' }]));
    nock(registry)
      .get('/pnpm')
      .reply(200, { versions: { '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now, full: true });

    expect(scope.isDone()).toBe(false);
    expect(JSON.parse(await read('pnpm.json'))).toMatchObject({
      versions: [{ version: '10.0.0' }],
    });
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
