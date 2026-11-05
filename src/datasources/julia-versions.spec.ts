import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fetchJuliaVersions } from './julia-versions.ts';

const host = 'https://julialang-s3.julialang.org';
const hash = (char: string): string => char.repeat(64);

/**
 * A file of `versions.json`.
 * @param path - the path below `/bin/`
 * @param triplet - the platform of the build
 * @param sha256 - the checksum
 */
function file(
  path: string,
  triplet: string,
  sha256?: string,
): { url: string; triplet: string; sha256?: string } {
  return { url: `${host}/bin/${path}`, triplet, ...(sha256 && { sha256 }) };
}

describe('datasources/julia-versions', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('lists the releases with the linux glibc archives and their sha256', async () => {
    nock(host)
      .get('/bin/versions.json')
      .reply(200, {
        '1.13.3': {
          files: [
            file('linux/x64/1.13/julia-1.13.3-linux-x86_64.tar.gz', 'x86_64-linux-gnu', hash('A')),
            file(
              'linux/aarch64/1.13/julia-1.13.3-linux-aarch64.tar.gz',
              'aarch64-linux-gnu',
              hash('b'),
            ),
            file('musl/x64/1.13/julia-1.13.3-musl-x86_64.tar.gz', 'x86_64-linux-musl', hash('c')),
            file('linux/x86/1.13/julia-1.13.3-linux-i686.tar.gz', 'i686-linux-gnu', hash('d')),
            file('mac/x64/1.13/julia-1.13.3-mac64.dmg', 'x86_64-apple-darwin14', hash('e')),
          ],
        },
        '1.14.0-rc1': {
          files: [
            file(
              'linux/x64/1.14/julia-1.14.0-rc1-linux-x86_64.tar.gz',
              'x86_64-linux-gnu',
              hash('f'),
            ),
          ],
        },
        // no valid checksum, so no file
        '1.6.7': {
          files: [file('linux/x64/1.6/julia-1.6.7-linux-x86_64.tar.gz', 'x86_64-linux-gnu', 'bad')],
        },
        '1.5.4': {
          files: [
            file('linux/x64/1.5/julia-1.5.4-linux-x86_64.tar.gz', 'x86_64-linux-gnu', hash('1')),
          ],
        },
        'not-a-version': {},
      });

    await expect(
      fetchJuliaVersions(
        'julia',
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        'semver',
        '1.6.0',
      ),
    ).resolves.toEqual([
      {
        version: '1.14.0-rc1',
        prerelease: true,
        files: [
          {
            name: 'julia-1.14.0-rc1-linux-x86_64.tar.gz',
            url: `${host}/bin/linux/x64/1.14/julia-1.14.0-rc1-linux-x86_64.tar.gz`,
            checksum: `sha256:${hash('f')}`,
            arch: 'amd64',
          },
        ],
      },
      {
        version: '1.13.3',
        files: [
          {
            name: 'julia-1.13.3-linux-aarch64.tar.gz',
            url: `${host}/bin/linux/aarch64/1.13/julia-1.13.3-linux-aarch64.tar.gz`,
            checksum: `sha256:${hash('b')}`,
            arch: 'arm64',
          },
          {
            name: 'julia-1.13.3-linux-x86_64.tar.gz',
            url: `${host}/bin/linux/x64/1.13/julia-1.13.3-linux-x86_64.tar.gz`,
            checksum: `sha256:${hash('a')}`,
            arch: 'amd64',
          },
        ],
      },
      { version: '1.6.7' },
    ]);
  });

  it('publishes no files when told so', async () => {
    nock(host)
      .get('/bin/versions.json')
      .reply(200, {
        '1.13.3': {
          files: [
            file('linux/x64/1.13/julia-1.13.3-linux-x86_64.tar.gz', 'x86_64-linux-gnu', hash('a')),
          ],
        },
      });

    await expect(
      fetchJuliaVersions('julia', undefined, undefined, undefined, false),
    ).resolves.toEqual([{ version: '1.13.3' }]);
  });
});
