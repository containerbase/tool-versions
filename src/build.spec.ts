import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { tools } from '@containerbase/base';
import { codeBlock } from 'common-tags';
import nock from 'nock';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from './build.ts';
import { type Source, ToolIndex, type ToolVersions } from './schema.ts';
import { toolSources } from './tools.ts';

const now = new Date('2026-10-08T12:00:00.000Z');
const pages = 'https://pages.example.com';
const registry = 'https://registry.npmjs.org';
const pnpmSource: Record<string, Source> = { pnpm: { datasource: 'npm', packageName: 'pnpm' } };

/**
 * A previously published file of pnpm.
 * @param versions - its versions
 * @param packageName - its npm package
 */
function previousPnpm(versions: ToolVersions['versions'], packageName = 'pnpm'): ToolVersions {
  return {
    tool: 'pnpm',
    source: { datasource: 'npm', packageName },
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
        npm: { datasource: 'npm', packageName: 'npm' },
        corepack: { datasource: 'npm', packageName: 'corepack' },
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
    expect(await read('pnpm.json')).toBe(
      `${codeBlock`
        {
          "tool": "pnpm",
          "source": {
            "datasource": "npm",
            "packageName": "pnpm"
          },
          "updatedAt": "2026-10-08T12:00:00.000Z",
          "versions": [
            {
              "version": "10.0.0"
            },
            {
              "version": "9.0.0"
            }
          ]
        }
      `}\n`,
    );
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
    expect(JSON.parse(await read('pnpm.json'))).toEqual(previous);
    expect(ToolIndex.parse(JSON.parse(await read('index.json')))).toEqual({
      updatedAt: '2026-10-08T12:00:00.000Z',
      tools: [{ tool: 'pnpm', file: 'pnpm.json', versionCount: 1 }],
    });
    expect(output).toContain(
      '::warning::pnpm: HttpError: GET https://registry.npmjs.org/pnpm failed with status 500, keeping the versions from 2026-10-07T03:00:00.000Z\n',
    );
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
      updatedAt: '2026-10-08T12:00:00.000Z',
    });
  });

  it('keeps the previous checksums of a fresh version', async () => {
    const checksums = { 'pnpm.tgz': 'sha512:abcdef12' };
    nock(pages)
      .get('/pnpm.json')
      .reply(200, previousPnpm([{ version: '9.0.0', checksums }]));
    nock(registry)
      .get('/pnpm')
      .reply(200, { versions: { '9.0.0': {}, '10.0.0': {} } });

    await build({ dir, sources: pnpmSource, now });

    expect(JSON.parse(await read('pnpm.json'))).toMatchObject({
      versions: [{ version: '10.0.0' }, { version: '9.0.0', checksums }],
    });
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
          'not-a-tool': { datasource: 'npm', packageName: 'not-a-tool' },
        },
        now,
      }),
    ).rejects.toThrow('Tools not found in @containerbase/base: not-a-tool');
    expect(await readdir(dir)).toEqual([]);
  });
});
