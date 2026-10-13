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

const prebuildHost = 'https://github.com';
const prebuildPath = '/containerbase/node-prebuild/releases/download';

/**
 * Mocks the releases of the node prebuilds.
 * @param releases - the GitHub releases
 */
function mockPrebuilds(releases: unknown[] = []): void {
  nock('https://api.github.com')
    .get('/repos/containerbase/node-prebuild/releases')
    .query({ per_page: '100' })
    .reply(200, releases);
}

/**
 * A prebuild release with its assets.
 * @param version - the version, also the tag
 * @param names - the asset names
 */
function prebuildRelease(
  version: string,
  names: string[],
): {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
} {
  return {
    tag_name: version,
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      browser_download_url: `${prebuildHost}${prebuildPath}/${version}/${name}`,
    })),
  };
}

describe('datasources/node-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('adds the prebuild files next to the nodejs.org ones, with arch and distro', async () => {
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [
        { version: 'v24.21.0', lts: 'Krypton' },
        { version: 'v22.1.0', lts: false },
      ])
      .get('/dist/v24.21.0/SHASUMS256.txt')
      .reply(200, shasums('24.21.0'))
      .get('/dist/v22.1.0/SHASUMS256.txt')
      .reply(404);
    mockPrebuilds([
      prebuildRelease('24.21.0', [
        'node-24.21.0-x86_64.tar.xz',
        'node-24.21.0-x86_64.tar.xz.sha512',
        'node-24.21.0-jammy-aarch64.tar.xz',
        'node-24.21.0-jammy-aarch64.tar.xz.sha512',
        'node-24.21.0-focal-aarch64.tar.xz',
        'node-24.21.0-focal-aarch64.tar.xz.sha512',
      ]),
      prebuildRelease('22.1.0', ['node-22.1.0-x86_64.tar.xz', 'node-22.1.0-x86_64.tar.xz.sha512']),
    ]);
    nock(prebuildHost)
      .get(`${prebuildPath}/24.21.0/node-24.21.0-x86_64.tar.xz.sha512`)
      .reply(200, 'd'.repeat(128))
      .get(`${prebuildPath}/24.21.0/node-24.21.0-jammy-aarch64.tar.xz.sha512`)
      .reply(200, 'e'.repeat(128))
      .get(`${prebuildPath}/22.1.0/node-22.1.0-x86_64.tar.xz.sha512`)
      .reply(200, 'f'.repeat(128));

    const [lts, old] = await fetchNodeVersions('node');

    expect(
      lts?.files?.map(({ name, arch, distro, checksum: sum }) => [name, arch, distro, sum]),
    ).toEqual([
      ['node-24.21.0-jammy-aarch64.tar.xz', 'arm64', 'jammy', `sha512:${'e'.repeat(128)}`],
      ['node-24.21.0-x86_64.tar.xz', 'amd64', undefined, `sha512:${'d'.repeat(128)}`],
      ['node-v24.21.0-linux-arm64.tar.xz', 'arm64', undefined, `sha256:${arm64}`],
      ['node-v24.21.0-linux-x64.tar.xz', 'amd64', undefined, `sha256:${x64}`],
    ]);
    // a version without nodejs.org files is published with its prebuild
    expect(old).toEqual({
      version: '22.1.0',
      files: [
        {
          name: 'node-22.1.0-x86_64.tar.xz',
          url: `${prebuildHost}${prebuildPath}/22.1.0/node-22.1.0-x86_64.tar.xz`,
          checksum: `sha512:${'f'.repeat(128)}`,
          arch: 'amd64',
        },
      ],
    });
  });

  it('reuses the known files and stops paging at a version with a prebuild', async () => {
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [{ version: 'v24.21.0', lts: false }]);
    const nodejs = files('24.21.0');
    const prebuild: ToolFile = {
      name: 'node-24.21.0-x86_64.tar.xz',
      url: `${prebuildHost}${prebuildPath}/24.21.0/node-24.21.0-x86_64.tar.xz`,
      checksum: `sha512:${'d'.repeat(128)}`,
      arch: 'amd64',
    };
    // the release is listed again, but nothing is requested for its known files
    mockPrebuilds([
      prebuildRelease('24.21.0', [
        'node-24.21.0-x86_64.tar.xz',
        'node-24.21.0-x86_64.tar.xz.sha512',
      ]),
    ]);

    await expect(
      fetchNodeVersions('node', undefined, new Map([['24.21.0', [...nodejs, prebuild]]])),
    ).resolves.toEqual([{ version: '24.21.0', files: [prebuild, ...nodejs] }]);
  });

  it('keeps the nodejs.org files and warns when the prebuild releases fail', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [{ version: 'v25.1.0', lts: false }])
      .get('/dist/v25.1.0/SHASUMS256.txt')
      .reply(200, shasums('25.1.0'));
    nock('https://api.github.com')
      .get('/repos/containerbase/node-prebuild/releases')
      .query({ per_page: '100' })
      .times(3)
      .reply(500);

    await expect(fetchNodeVersions('node')).resolves.toEqual([
      { version: '25.1.0', files: files('25.1.0') },
    ]);
    expect(output).toEqual([
      '::warning::node: no prebuild files: HttpError: GET https://api.github.com/repos/containerbase/node-prebuild/releases?per_page=100 failed with status 500\n',
    ]);
  });

  it('requests no prebuild releases when told not to fetch files', async () => {
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [{ version: 'v25.1.0', lts: false }]);

    await expect(
      fetchNodeVersions('node', undefined, undefined, undefined, false),
    ).resolves.toEqual([{ version: '25.1.0' }]);
  });

  it('drops the v, flags lts releases and sorts newest first', async () => {
    mockPrebuilds();
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
    mockPrebuilds();
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
    mockPrebuilds();
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
    mockPrebuilds();
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    nock(dist)
      .get('/dist/index.json')
      .reply(200, [{ version: 'v25.1.0', lts: false }])
      .get('/dist/v25.1.0/SHASUMS256.txt')
      .times(3)
      .reply(500);

    await expect(fetchNodeVersions('node')).resolves.toEqual([{ version: '25.1.0' }]);
    expect(output).toEqual([
      `::warning::node: no checksum from ${dist}/dist/v25.1.0/SHASUMS256.txt: HttpError: GET ${dist}/dist/v25.1.0/SHASUMS256.txt failed with status 500\n`,
    ]);
  });

  it('fails on an error response', async () => {
    nock(dist).get('/dist/index.json').times(3).reply(500);

    await expect(fetchNodeVersions('node')).rejects.toThrow(
      'GET https://nodejs.org/dist/index.json failed with status 500',
    );
  });
});
