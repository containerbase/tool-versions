import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ToolFile } from '../schema.ts';
import { fetchHaskellDownloads } from './haskell-downloads.ts';

const host = 'https://downloads.haskell.org';
const sum = (char: string): string => char.repeat(64);

describe('datasources/haskell-downloads', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('reads the ghc releases from the folders and their SHA256SUMS', async () => {
    nock(host)
      .get('/~ghc/')
      .reply(
        200,
        [
          '<a href="../">Parent</a>',
          '<a href="9.8.2/">9.8.2/</a>',
          '<a href="9.8.1-alpha1/">9.8.1-alpha1/</a>',
          '<a href="latest/">latest/</a>',
          '<a href="9.6.0.20230210/">9.6.0.20230210/</a>',
          '<a href="ghc-9.8.2.tar.xz">file</a>',
        ].join('\n'),
      )
      .get('/~ghc/9.8.2/SHA256SUMS')
      .reply(
        200,
        [
          `${sum('a')}  ./ghc-9.8.2-x86_64-deb10-linux.tar.xz`,
          `${sum('b')}  ./ghc-9.8.2-aarch64-deb10-linux.tar.xz`,
          `${sum('c')}  ./ghc-9.8.2-x86_64-fedora33-linux.tar.xz`,
        ].join('\n'),
      )
      .get('/~ghc/9.6.0.20230210/SHA256SUMS')
      .reply(404);

    await expect(fetchHaskellDownloads('ghc')).resolves.toEqual([
      {
        version: '9.8.2',
        files: [
          {
            name: 'ghc-9.8.2-aarch64-deb10-linux.tar.xz',
            url: `${host}/~ghc/9.8.2/ghc-9.8.2-aarch64-deb10-linux.tar.xz`,
            checksum: `sha256:${sum('b')}`,
            arch: 'arm64',
          },
          {
            name: 'ghc-9.8.2-x86_64-deb10-linux.tar.xz',
            url: `${host}/~ghc/9.8.2/ghc-9.8.2-x86_64-deb10-linux.tar.xz`,
            checksum: `sha256:${sum('a')}`,
            arch: 'amd64',
          },
        ],
      },
      { version: '9.6.0.20230210' },
    ]);
  });

  it('skips the releases older than the minimum version, without reading their SHA256SUMS', async () => {
    nock(host)
      .get('/~ghc/')
      .reply(200, ['<a href="9.8.2/">9.8.2/</a>', '<a href="8.8.4/">8.8.4/</a>'].join('\n'))
      .get('/~ghc/9.8.2/SHA256SUMS')
      .reply(404);
    // an unmocked request of the old release would fail the fetch

    await expect(
      fetchHaskellDownloads(
        'ghc',
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        'pvp',
        '8.10.1',
      ),
    ).resolves.toEqual([{ version: '9.8.2' }]);
  });

  it('reads the cabal releases, with the build of the version', async () => {
    nock(host)
      .get('/~cabal/')
      .reply(
        200,
        [
          '<a href="cabal-install-3.18.0.0/">cabal-install-3.18.0.0/</a>',
          '<a href="cabal-install-3.10.3.0/">cabal-install-3.10.3.0/</a>',
          '<a href="Cabal-3.10.3.0/">Cabal-3.10.3.0/</a>',
        ].join('\n'),
      )
      .get('/~cabal/cabal-install-3.18.0.0/SHA256SUMS')
      .reply(200, `${sum('d')}  cabal-install-3.18.0.0-x86_64-linux-unknown.tar.xz\n`)
      .get('/~cabal/cabal-install-3.10.3.0/SHA256SUMS')
      .reply(
        200,
        `${sum('e')}  cabal-install-3.10.3.0-x86_64-linux-deb10.tar.xz\n${sum('f')} *cabal-install-3.10.3.0-aarch64-linux-deb10.tar.xz\n`,
      );

    const versions = await fetchHaskellDownloads('cabal');

    // the generic linux build of 3.18 is named `linux-unknown`
    expect(versions.map(({ version, files }) => [version, files?.map(({ name }) => name)])).toEqual(
      [
        ['3.18.0.0', ['cabal-install-3.18.0.0-x86_64-linux-unknown.tar.xz']],
        [
          '3.10.3.0',
          [
            'cabal-install-3.10.3.0-aarch64-linux-deb10.tar.xz',
            'cabal-install-3.10.3.0-x86_64-linux-deb10.tar.xz',
          ],
        ],
      ],
    );
  });

  it('reuses the known files and only reads missing ones', async () => {
    nock(host)
      .get('/~ghc/')
      .reply(200, '<a href="9.8.2/">9.8.2/</a>\n<a href="9.6.6/">9.6.6/</a>')
      .get('/~ghc/9.6.6/SHA256SUMS')
      .reply(200, `${sum('b')}  ./ghc-9.6.6-aarch64-deb10-linux.tar.xz\n`);
    const file = (version: string, arch: 'amd64' | 'arm64', char: string): ToolFile => {
      const name = `ghc-${version}-${arch === 'amd64' ? 'x86_64' : 'aarch64'}-deb10-linux.tar.xz`;
      return {
        name,
        url: `${host}/~ghc/${version}/${name}`,
        checksum: `sha256:${sum(char)}`,
        arch,
      };
    };

    await expect(
      fetchHaskellDownloads(
        'ghc',
        undefined,
        new Map([
          ['9.8.2', [file('9.8.2', 'amd64', 'a'), file('9.8.2', 'arm64', 'c')]],
          ['9.6.6', [file('9.6.6', 'amd64', 'd')]],
        ]),
      ),
    ).resolves.toEqual([
      { version: '9.8.2', files: [file('9.8.2', 'arm64', 'c'), file('9.8.2', 'amd64', 'a')] },
      { version: '9.6.6', files: [file('9.6.6', 'arm64', 'b'), file('9.6.6', 'amd64', 'd')] },
    ]);
  });

  it('fails for an unknown package and on an error response', async () => {
    await expect(fetchHaskellDownloads('stack')).rejects.toThrow('Unknown haskell package stack');

    nock(host).get('/~ghc/').reply(404);
    await expect(fetchHaskellDownloads('ghc')).rejects.toThrow('failed with status 404');
  });
});
