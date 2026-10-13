import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchDotnetVersions } from './dotnet-version.ts';

const host = 'https://builds.dotnet.microsoft.com';
const meta = '/dotnet/release-metadata';
const hash = (char: string): string => char.repeat(128);

/**
 * An sdk of a release with its files.
 * @param version - the sdk version
 * @param files - the files with their runtime id and hash
 */
function sdk(
  version: string,
  files: [string, string, string][],
): { version: string; files: { name: string; rid: string; hash: string }[] } {
  return { version, files: files.map(([name, rid, sum]) => ({ name, rid, hash: sum })) };
}

describe('datasources/dotnet-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('lists the sdks of all channels with the linux archives and their sha512', async () => {
    nock(host)
      .get(`${meta}/releases-index.json`)
      .reply(200, {
        'releases-index': [
          { 'releases.json': `${host}${meta}/9.0/releases.json` },
          { 'releases.json': `${host}${meta}/8.0/releases.json` },
        ],
      })
      .get(`${meta}/9.0/releases.json`)
      .reply(200, {
        releases: [
          {
            'release-date': '2025-02-11',
            sdk: sdk('9.0.200', [
              ['dotnet-sdk-linux-x64.tar.gz', 'linux-x64', hash('a')],
              ['dotnet-sdk-linux-arm64.tar.gz', 'linux-arm64', hash('B')],
              ['dotnet-sdk-linux-musl-x64.tar.gz', 'linux-musl-x64', hash('c')],
              ['dotnet-sdk-win-x64.zip', 'win-x64', hash('d')],
            ]),
            sdks: [
              sdk('9.0.200', [['dotnet-sdk-linux-x64.tar.gz', 'linux-x64', hash('f')]]),
              sdk('9.0.103', [['dotnet-sdk-linux-x64.tar.gz', 'linux-x64', hash('e')]]),
            ],
          },
          {
            'release-date': '2024-11-12',
            sdk: sdk('9.0.100-rc.2.24474.11', [
              ['dotnet-sdk-linux-x64.tar.gz', 'linux-x64', hash('1')],
            ]),
          },
        ],
      })
      .get(`${meta}/8.0/releases.json`)
      .reply(200, {
        releases: [
          {
            'release-date': '2024-01-09',
            sdk: sdk('8.0.101', [['dotnet-sdk-linux-x64.tar.gz', 'linux-x64', 'not a hash']]),
            sdks: null,
          },
        ],
      });

    const url = (version: string, rid: string): string =>
      `${host}/dotnet/Sdk/${version}/dotnet-sdk-${version}-${rid}.tar.gz`;
    await expect(fetchDotnetVersions('dotnet-sdk')).resolves.toEqual([
      {
        version: '9.0.200',
        releaseTimestamp: '2025-02-11T00:00:00.000Z',
        files: [
          {
            name: 'dotnet-sdk-9.0.200-linux-arm64.tar.gz',
            url: url('9.0.200', 'linux-arm64'),
            checksum: `sha512:${hash('b')}`,
            arch: 'arm64',
          },
          {
            name: 'dotnet-sdk-9.0.200-linux-x64.tar.gz',
            url: url('9.0.200', 'linux-x64'),
            checksum: `sha512:${hash('a')}`,
            arch: 'amd64',
          },
        ],
      },
      {
        version: '9.0.103',
        releaseTimestamp: '2025-02-11T00:00:00.000Z',
        files: [
          {
            name: 'dotnet-sdk-9.0.103-linux-x64.tar.gz',
            url: url('9.0.103', 'linux-x64'),
            checksum: `sha512:${hash('e')}`,
            arch: 'amd64',
          },
        ],
      },
      {
        version: '9.0.100-rc.2.24474.11',
        prerelease: true,
        releaseTimestamp: '2024-11-12T00:00:00.000Z',
        files: [
          {
            name: 'dotnet-sdk-9.0.100-rc.2.24474.11-linux-x64.tar.gz',
            url: url('9.0.100-rc.2.24474.11', 'linux-x64'),
            checksum: `sha512:${hash('1')}`,
            arch: 'amd64',
          },
        ],
      },
      // no valid hash, so no file
      { version: '8.0.101', releaseTimestamp: '2024-01-09T00:00:00.000Z' },
    ]);
  });

  it('skips a channel which fails with a warning, and publishes no files when told so', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    nock(host)
      .get(`${meta}/releases-index.json`)
      .times(2)
      .reply(200, {
        'releases-index': [
          { 'releases.json': `${host}${meta}/9.0/releases.json` },
          { 'releases.json': `${host}${meta}/3.1/releases.json` },
        ],
      })
      .get(`${meta}/9.0/releases.json`)
      .times(2)
      .reply(200, {
        releases: [
          {
            sdk: sdk('9.0.200', [['dotnet-sdk-linux-x64.tar.gz', 'linux-x64', hash('a')]]),
          },
        ],
      })
      .get(`${meta}/3.1/releases.json`)
      .times(2)
      .reply(404);

    await expect(fetchDotnetVersions('dotnet-sdk')).resolves.toMatchObject([
      { version: '9.0.200', files: [{ arch: 'amd64' }] },
    ]);
    expect(output).toEqual([
      `::warning::dotnet: no releases from ${host}${meta}/3.1/releases.json: HttpError: GET ${host}${meta}/3.1/releases.json failed with status 404\n`,
    ]);
    await expect(
      fetchDotnetVersions('dotnet-sdk', undefined, undefined, undefined, false),
    ).resolves.toEqual([{ version: '9.0.200' }]);
  });

  it('fails on an error response', async () => {
    nock(host).get(`${meta}/releases-index.json`).reply(404);

    await expect(fetchDotnetVersions('dotnet-sdk')).rejects.toThrow('failed with status 404');
  });
});
