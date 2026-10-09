import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolFile } from '../schema.ts';
import { fetchNodeVersions } from './node-version.ts';

const dist = 'https://nodejs.org';
const x64 = 'a'.repeat(64);
const arm64 = 'b'.repeat(64);

/**
 * The `SHASUMS256.txt` of a release.
 * @param version - the version
 */
function shasums(version: string): string {
  return [
    `${'c'.repeat(64)}  node-v${version}-linux-ppc64le.tar.xz`,
    `${x64}  node-v${version}-linux-x64.tar.xz`,
    `${arm64.toUpperCase()}  node-v${version}-linux-arm64.tar.xz`,
    '',
  ].join('\n');
}

/**
 * The published files of a release.
 * @param version - the version
 */
function files(version: string): ToolFile[] {
  return [
    {
      name: `node-v${version}-linux-arm64.tar.xz`,
      url: `${dist}/dist/v${version}/node-v${version}-linux-arm64.tar.xz`,
      checksum: `sha256:${arm64}`,
      arch: 'arm64',
    },
    {
      name: `node-v${version}-linux-x64.tar.xz`,
      url: `${dist}/dist/v${version}/node-v${version}-linux-x64.tar.xz`,
      checksum: `sha256:${x64}`,
      arch: 'amd64',
    },
  ];
}

describe('datasources/node-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('drops the v, flags lts releases and sorts newest first', async () => {
    const scope = nock(dist)
      .get('/dist/index.json')
      .reply(200, [
        { version: 'v24.21.0', lts: 'Krypton' },
        { version: 'v25.1.0', lts: false },
        { version: 'v25.10.0', lts: false },
        { version: 'v0.1.14', lts: false },
        { version: 'invalid', lts: false },
      ])
      .get('/dist/v24.21.0/SHASUMS256.txt')
      .reply(200, shasums('24.21.0'))
      .get('/dist/v25.1.0/SHASUMS256.txt')
      .reply(200, shasums('25.1.0'))
      .get('/dist/v25.10.0/SHASUMS256.txt')
      .reply(200, shasums('25.10.0'))
      .get('/dist/v0.1.14/SHASUMS256.txt')
      .reply(404);

    await expect(fetchNodeVersions('node')).resolves.toEqual([
      { version: '25.10.0', files: files('25.10.0') },
      { version: '25.1.0', files: files('25.1.0') },
      { version: '24.21.0', lts: true, files: files('24.21.0') },
      { version: '0.1.14' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('reads the release timestamp from the date', async () => {
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [
        { version: 'v25.1.0', date: '2025-10-28', lts: false },
        { version: 'v25.0.0', lts: false },
      ])
      .get('/dist/v25.1.0/SHASUMS256.txt')
      .reply(404)
      .get('/dist/v25.0.0/SHASUMS256.txt')
      .reply(404);

    await expect(fetchNodeVersions('node')).resolves.toEqual([
      { version: '25.1.0', releaseTimestamp: '2025-10-28T00:00:00.000Z' },
      { version: '25.0.0' },
    ]);
  });

  it('only reads the missing files and skips complete releases', async () => {
    const scope = nock(dist)
      .get('/dist/index.json')
      .reply(200, [
        { version: 'v25.1.0', lts: false },
        { version: 'v25.0.0', lts: false },
      ])
      .get('/dist/v25.0.0/SHASUMS256.txt')
      .reply(200, shasums('25.0.0'));
    const previous = new Map([
      ['25.1.0', files('25.1.0')],
      ['25.0.0', files('25.0.0').slice(1)],
    ]);

    await expect(fetchNodeVersions('node', undefined, previous)).resolves.toEqual([
      { version: '25.1.0', files: files('25.1.0') },
      { version: '25.0.0', files: files('25.0.0') },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('warns and skips the files when the checksums fail to download', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [{ version: 'v25.1.0', lts: false }])
      .get('/dist/v25.1.0/SHASUMS256.txt')
      .reply(500);

    await expect(fetchNodeVersions('node')).resolves.toEqual([{ version: '25.1.0' }]);
    expect(output).toEqual([
      `::warning::node: no checksum from ${dist}/dist/v25.1.0/SHASUMS256.txt: HttpError: GET ${dist}/dist/v25.1.0/SHASUMS256.txt failed with status 500\n`,
    ]);
  });

  it('fails on an error response', async () => {
    nock(dist).get('/dist/index.json').reply(500);

    await expect(fetchNodeVersions('node')).rejects.toThrow(
      'GET https://nodejs.org/dist/index.json failed with status 500',
    );
  });
});
