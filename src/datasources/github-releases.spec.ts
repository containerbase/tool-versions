import { createHash } from 'node:crypto';
import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetDownloadBudget } from '../download.ts';
import type { AssetTemplate, FileTemplate } from '../files.ts';
import type { ToolFile } from '../schema.ts';
import { fetchGithubReleases, nextPage } from './github-releases.ts';

const api = 'https://api.github.com';
const none = new Set<string>();
const dl = 'https://github.com/containerbase/python-prebuild/releases/download';
const repo = 'containerbase/python-prebuild';
const sum1 = 'a'.repeat(128);
const sum2 = 'b'.repeat(128);
const sum3 = 'c'.repeat(128);

/**
 * A release of the GitHub api.
 * @param tag_name - the tag
 * @param prerelease - whether GitHub marks it as prerelease
 * @param draft - whether it is a draft
 */
function release(
  tag_name: string,
  prerelease = false,
  draft = false,
): { tag_name: string; prerelease: boolean; draft: boolean } {
  return { tag_name, prerelease, draft };
}

/**
 * A release with files.
 * @param tag_name - the tag
 * @param files - the file names
 */
function withAssets(
  tag_name: string,
  files: string[],
): ReturnType<typeof release> & {
  assets: { name: string; browser_download_url: string }[];
} {
  return {
    ...release(tag_name),
    assets: files.map((name) => ({
      name,
      browser_download_url: `${dl}/${tag_name}/${name}`,
    })),
  };
}

/**
 * A published file of a prebuild.
 * @param version - the version
 * @param suffix - the rest of the file name
 * @param checksum - the digest
 * @param extra - arch and distro
 */
function prebuildFile(
  version: string,
  suffix: string,
  checksum: string,
  extra: Pick<ToolFile, 'arch' | 'distro'>,
): ToolFile {
  const name = `python-${version}-${suffix}.tar.xz`;
  return { name, url: `${dl}/${version}/${name}`, checksum: `sha512:${checksum}`, ...extra };
}

describe('datasources/github-releases', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads all pages, drops the v, flags prereleases and sorts newest first', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const page2 = `${api}/repositories/1/releases?per_page=100&page=2`;
    const scope = nock(api, { badheaders: ['authorization'] })
      .get('/repos/helm/helm/releases')
      .query({ per_page: '100' })
      .reply(200, [release('v4.0.0-rc.1'), release('v3.19.0'), release('v4.0.0', false, true)], {
        link: `<${page2}>; rel="next", <${page2}>; rel="last"`,
      })
      .get('/repositories/1/releases')
      .query({ per_page: '100', page: '2' })
      .reply(200, [release('v3.9.0'), release('v3.20.0', true), release('foo')]);

    await expect(fetchGithubReleases('helm/helm', none)).resolves.toEqual([
      { version: '4.0.0-rc.1', prerelease: true },
      { version: '3.20.0', prerelease: true },
      { version: '3.19.0' },
      { version: '3.9.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('stops paging after a page with a known version', async () => {
    const page2 = `${api}/repositories/1/releases?per_page=100&page=2`;
    const scope = nock(api)
      .get('/repos/helm/helm/releases')
      .query({ per_page: '100' })
      .reply(200, [release('v4.1.0'), release('v4.0.0')], {
        link: `<${page2}>; rel="next"`,
      });

    await expect(fetchGithubReleases('helm/helm', new Set(['4.0.0']))).resolves.toEqual([
      { version: '4.1.0' },
      { version: '4.0.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('reads the release timestamp from published_at', async () => {
    nock(api)
      .get('/repos/helm/helm/releases')
      .query({ per_page: '100' })
      .reply(200, [
        { ...release('v3.19.0'), published_at: '2025-09-11T18:15:42+02:00' },
        { ...release('v3.18.0'), published_at: null },
        release('v3.17.0'),
      ]);

    await expect(fetchGithubReleases('helm/helm', none)).resolves.toEqual([
      { version: '3.19.0', releaseTimestamp: '2025-09-11T16:15:42.000Z' },
      { version: '3.18.0' },
      { version: '3.17.0' },
    ]);
  });

  it('validates and sorts the tags with the versioning', async () => {
    nock(api)
      .get('/repos/containerbase/erlang-prebuild/releases')
      .query({ per_page: '100' })
      .reply(200, [
        release('28.5.0.7'),
        release('28.5.0.10'),
        release('28.5.0'),
        release('29.0-rc1'),
        release('27.3.4.9'),
        release('foo'),
      ]);

    await expect(
      fetchGithubReleases(
        'containerbase/erlang-prebuild',
        none,
        new Map(),
        undefined,
        true,
        undefined,
        'docker',
      ),
    ).resolves.toEqual([
      { version: '29.0-rc1', prerelease: true },
      { version: '28.5.0.10' },
      { version: '28.5.0.7' },
      { version: '28.5.0' },
      { version: '27.3.4.9' },
    ]);
  });

  it('publishes assets without arch and distro as they are', async () => {
    nock(api)
      .get('/repos/containerbase/composer-prebuild/releases')
      .query({ per_page: '100' })
      .reply(200, [
        {
          ...release('2.8.12'),
          assets: [
            {
              name: 'composer-2.8.12.tar.xz',
              browser_download_url:
                'https://github.com/containerbase/composer-prebuild/releases/download/2.8.12/composer-2.8.12.tar.xz',
            },
            {
              name: 'composer-2.8.12.tar.xz.sha512',
              browser_download_url:
                'https://github.com/containerbase/composer-prebuild/releases/download/2.8.12/composer-2.8.12.tar.xz.sha512',
            },
          ],
        },
      ]);
    nock('https://github.com')
      .get(
        '/containerbase/composer-prebuild/releases/download/2.8.12/composer-2.8.12.tar.xz.sha512',
      )
      .reply(200, sum1);

    await expect(fetchGithubReleases('containerbase/composer-prebuild', none)).resolves.toEqual([
      {
        version: '2.8.12',
        files: [
          {
            name: 'composer-2.8.12.tar.xz',
            url: 'https://github.com/containerbase/composer-prebuild/releases/download/2.8.12/composer-2.8.12.tar.xz',
            checksum: `sha512:${sum1}`,
          },
        ],
      },
    ]);
  });

  it('authenticates with GITHUB_TOKEN', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'some-token');
    const scope = nock(api, {
      reqheaders: { authorization: 'Bearer some-token' },
    })
      .get('/repos/containerbase/python-prebuild/releases')
      .query({ per_page: '100' })
      .reply(200, [release('3.14.8')]);

    await expect(fetchGithubReleases('containerbase/python-prebuild', none)).resolves.toEqual([
      { version: '3.14.8' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  describe('files', () => {
    /** Collects what is written to stdout. */
    function captureOutput(): string[] {
      const output: string[] = [];
      vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
      return output;
    }

    it('reads the files from the sidecar files, with arch and distro', async () => {
      const names = [
        'python-3.14.8-jammy-x86_64.tar.xz',
        'python-3.14.8-jammy-x86_64.tar.xz.sha512',
        'python-3.14.8-noble-aarch64.tar.xz',
        'python-3.14.8-noble-aarch64.tar.xz.sha512',
        'python-3.14.8-x86_64.tar.xz',
        'python-3.14.8-x86_64.tar.xz.sha512',
        'other.tar.xz',
        'other.tar.xz.sha512',
        'notes.txt',
      ];
      const scope = nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', names)]);
      const downloads = nock(dl)
        .get('/3.14.8/python-3.14.8-jammy-x86_64.tar.xz.sha512')
        .reply(200, `${sum1.toUpperCase()}  python-3.14.8-jammy-x86_64.tar.xz\n`)
        .get('/3.14.8/python-3.14.8-noble-aarch64.tar.xz.sha512')
        .reply(200, sum2)
        .get('/3.14.8/python-3.14.8-x86_64.tar.xz.sha512')
        .reply(200, sum3)
        .get('/3.14.8/other.tar.xz.sha512')
        .reply(200, sum1);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([
        {
          version: '3.14.8',
          files: [
            { name: 'other.tar.xz', url: `${dl}/3.14.8/other.tar.xz`, checksum: `sha512:${sum1}` },
            prebuildFile('3.14.8', 'jammy-x86_64', sum1, { arch: 'amd64', distro: 'jammy' }),
            prebuildFile('3.14.8', 'noble-aarch64', sum2, { arch: 'arm64', distro: 'noble' }),
            prebuildFile('3.14.8', 'x86_64', sum3, { arch: 'amd64' }),
          ],
        },
      ]);
      expect(scope.isDone()).toBe(true);
      expect(downloads.isDone()).toBe(true);
    });

    it('skips the prebuilds of unsupported distros without downloading their checksums', async () => {
      const names = [
        'python-3.14.8-bionic-x86_64.tar.xz',
        'python-3.14.8-bionic-x86_64.tar.xz.sha512',
        'python-3.14.8-focal-aarch64.tar.xz',
        'python-3.14.8-focal-aarch64.tar.xz.sha512',
        'python-3.14.8-noble-x86_64.tar.xz',
        'python-3.14.8-noble-x86_64.tar.xz.sha512',
      ];
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', names)]);
      const downloads = nock(dl)
        .get('/3.14.8/python-3.14.8-noble-x86_64.tar.xz.sha512')
        .reply(200, sum1);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([
        {
          version: '3.14.8',
          files: [prebuildFile('3.14.8', 'noble-x86_64', sum1, { arch: 'amd64', distro: 'noble' })],
        },
      ]);
      expect(downloads.isDone()).toBe(true);
    });

    it('leaves out the files of releases without sidecar files', async () => {
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz'])]);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
    });

    it('reuses the previous files by name', async () => {
      const x86 = prebuildFile('3.14.8', 'x86_64', sum1, { arch: 'amd64' });
      const aarch64 = prebuildFile('3.14.8', 'aarch64', sum2, { arch: 'arm64' });
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [
          withAssets('3.14.8', [
            'python-3.14.8-x86_64.tar.xz',
            'python-3.14.8-x86_64.tar.xz.sha512',
            'python-3.14.8-aarch64.tar.xz',
            'python-3.14.8-aarch64.tar.xz.sha512',
          ]),
          withAssets('3.14.7', ['b.tar.xz', 'b.tar.xz.sha512']),
        ]);
      const downloads = nock(dl)
        .get('/3.14.8/python-3.14.8-aarch64.tar.xz.sha512')
        .reply(200, sum2)
        .get('/3.14.7/b.tar.xz.sha512')
        .reply(200, sum3);
      const previous = new Map([['3.14.8', [x86]]]);

      await expect(fetchGithubReleases(repo, new Set(['3.14.8']), previous)).resolves.toEqual([
        { version: '3.14.8', files: [aarch64, x86] },
        {
          version: '3.14.7',
          files: [{ name: 'b.tar.xz', url: `${dl}/3.14.7/b.tar.xz`, checksum: `sha512:${sum3}` }],
        },
      ]);
      expect(downloads.isDone()).toBe(true);
      expect(previous.get('3.14.8')).toEqual([x86]);
    });

    it('makes no request when all files are known', async () => {
      const x86 = prebuildFile('3.14.8', 'x86_64', sum1, { arch: 'amd64' });
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [
          withAssets('3.14.8', [
            'python-3.14.8-x86_64.tar.xz',
            'python-3.14.8-x86_64.tar.xz.sha512',
          ]),
        ]);

      await expect(
        fetchGithubReleases(repo, new Set(['3.14.8']), new Map([['3.14.8', [x86]]])),
      ).resolves.toEqual([{ version: '3.14.8', files: [x86] }]);
    });

    it('stays silent when a checksum file is missing', async () => {
      const output = captureOutput();
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz', 'a.tar.xz.sha512'])]);
      nock(dl).get('/3.14.8/a.tar.xz.sha512').reply(404);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
      expect(output).toEqual([]);
    });

    it('warns and skips the file after another failure', async () => {
      const output = captureOutput();
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz', 'a.tar.xz.sha512'])]);
      nock(dl).get('/3.14.8/a.tar.xz.sha512').times(3).reply(500);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
      expect(output).toEqual([
        `::warning::${repo}: no checksum from ${dl}/3.14.8/a.tar.xz.sha512: HttpError: GET ${dl}/3.14.8/a.tar.xz.sha512 failed with status 500\n`,
      ]);
    });

    it('warns and skips a checksum file without a digest', async () => {
      const output = captureOutput();
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz', 'a.tar.xz.sha512'])]);
      nock(dl).get('/3.14.8/a.tar.xz.sha512').reply(200, 'not a digest');

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
      expect(output).toEqual([
        `::warning::${repo}: no valid sha512 digest in ${dl}/3.14.8/a.tar.xz.sha512\n`,
      ]);
    });

    it('tries the next checksum file and stays silent when all are missing', async () => {
      const output = captureOutput();
      const host = 'https://files.example.com';
      const template: FileTemplate = (version) => [
        {
          name: `tool-${version}.tgz`,
          url: `${host}/tool-${version}.tgz`,
          checksumUrls: [
            `${host}/tool-${version}.tgz.sha256sum`,
            `${host}/tool-${version}.tgz.sha256`,
          ],
          algorithm: 'sha256',
        },
      ];
      nock(api)
        .get('/repos/some/tool/releases')
        .query({ per_page: '100' })
        .reply(200, [release('v2.0.0'), release('v1.0.0')]);
      nock(host)
        .get('/tool-2.0.0.tgz.sha256sum')
        .reply(404)
        .get('/tool-2.0.0.tgz.sha256')
        .reply(200, 'd'.repeat(64))
        .get('/tool-1.0.0.tgz.sha256sum')
        .reply(404)
        .get('/tool-1.0.0.tgz.sha256')
        .reply(404);

      await expect(fetchGithubReleases('some/tool', none, new Map(), template)).resolves.toEqual([
        {
          version: '2.0.0',
          files: [
            {
              name: 'tool-2.0.0.tgz',
              url: `${host}/tool-2.0.0.tgz`,
              checksum: `sha256:${'d'.repeat(64)}`,
            },
          ],
        },
        { version: '1.0.0' },
      ]);
      expect(output).toEqual([]);
    });

    it('lists the files with a template', async () => {
      const template: FileTemplate = (version) => [
        {
          name: `tool-${version}.tgz`,
          url: `https://files.example.com/tool-${version}.tgz`,
          checksumUrls: [`https://files.example.com/tool-${version}.tgz.sha256sum`],
          algorithm: 'sha256',
          arch: 'arm64',
        },
      ];
      nock(api)
        .get('/repos/some/tool/releases')
        .query({ per_page: '100' })
        .reply(200, [release('v1.2.0')]);
      nock('https://files.example.com')
        .get('/tool-1.2.0.tgz.sha256sum')
        .reply(200, `${'d'.repeat(64)}  tool-1.2.0.tgz\n`);

      await expect(fetchGithubReleases('some/tool', none, new Map(), template)).resolves.toEqual([
        {
          version: '1.2.0',
          files: [
            {
              name: 'tool-1.2.0.tgz',
              url: 'https://files.example.com/tool-1.2.0.tgz',
              checksum: `sha256:${'d'.repeat(64)}`,
              arch: 'arm64',
            },
          ],
        },
      ]);
    });
  });

  describe('asset templates', () => {
    const host = 'https://github.com';
    const download = '/some/tool/releases/download';
    const dlUrl = (tag: string, name: string): string => `${host}${download}/${tag}/${name}`;
    const hex = (char: string): string => char.repeat(64);

    /**
     * A release with assets.
     * @param tag - the tag
     * @param names - the asset names
     */
    function withNames(
      tag: string,
      names: string[],
    ): ReturnType<typeof release> & {
      assets: { name: string; browser_download_url: string }[];
    } {
      return {
        ...release(tag),
        assets: names.map((name) => ({ name, browser_download_url: dlUrl(tag, name) })),
      };
    }

    /**
     * Mocks the releases of the repository.
     * @param releases - the releases
     */
    function mockReleases(releases: unknown[]): void {
      nock(api).get('/repos/some/tool/releases').query({ per_page: '100' }).reply(200, releases);
    }

    /**
     * Fetches the releases with a template.
     * @param template - the asset template
     */
    async function fetchWith(template: AssetTemplate): ReturnType<typeof fetchGithubReleases> {
      return await fetchGithubReleases('some/tool', none, new Map(), template);
    }

    const perArch: AssetTemplate['files'] = (v) => [
      { arch: 'amd64', name: `tool_${v}_linux_amd64.tar.gz` },
      { arch: 'arm64', name: `tool_${v}_linux_arm64.tar.gz` },
    ];

    it('reads the checksums from a list and downloads it once per release', async () => {
      mockReleases([
        withNames('v1.2.0', [
          'tool_1.2.0_linux_amd64.tar.gz',
          'tool_1.2.0_linux_arm64.tar.gz',
          'checksums.txt',
        ]),
      ]);
      const list = nock(host)
        .get(`${download}/v1.2.0/checksums.txt`)
        .once()
        .reply(
          200,
          `${hex('a')}  tool_1.2.0_linux_amd64.tar.gz\n${hex('b')} *tool_1.2.0_linux_arm64.tar.gz\n`,
        );

      await expect(
        fetchWith({ files: perArch, checksum: { list: () => 'checksums.txt' } }),
      ).resolves.toEqual([
        {
          version: '1.2.0',
          files: [
            {
              name: 'tool_1.2.0_linux_amd64.tar.gz',
              url: dlUrl('v1.2.0', 'tool_1.2.0_linux_amd64.tar.gz'),
              checksum: `sha256:${hex('a')}`,
              arch: 'amd64',
            },
            {
              name: 'tool_1.2.0_linux_arm64.tar.gz',
              url: dlUrl('v1.2.0', 'tool_1.2.0_linux_arm64.tar.gz'),
              checksum: `sha256:${hex('b')}`,
              arch: 'arm64',
            },
          ],
        },
      ]);
      expect(list.isDone()).toBe(true);
    });

    it('decodes a UTF-16LE checksum list with a byte order mark', async () => {
      mockReleases([withNames('v7.4.0', ['tool_7.4.0_linux_amd64.tar.gz', 'hashes.sha256'])]);
      const text = `${hex('c').toUpperCase()}  ./tool_7.4.0_linux_amd64.tar.gz\r\n`;
      nock(host)
        .get(`${download}/v7.4.0/hashes.sha256`)
        .reply(200, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));

      const [version] = await fetchWith({
        files: perArch,
        checksum: { list: () => 'hashes.sha256' },
      });

      expect(version?.files).toMatchObject([{ checksum: `sha256:${hex('c')}`, arch: 'amd64' }]);
    });

    it('reads the checksum of a clearsigned list', async () => {
      mockReleases([withNames('v3.7.0', ['tool_3.7.0_linux_arm64.tar.gz', 'sha256sums.asc'])]);
      nock(host)
        .get(`${download}/v3.7.0/sha256sums.asc`)
        .reply(
          200,
          [
            '-----BEGIN PGP SIGNED MESSAGE-----',
            'Hash: SHA256',
            '',
            `${hex('d')}  ./tool_3.7.0_linux_arm64.tar.gz`,
            '-----BEGIN PGP SIGNATURE-----',
            'iQIzBAEBCAAdFiEE',
            '-----END PGP SIGNATURE-----',
          ].join('\n'),
        );

      const [version] = await fetchWith({
        files: perArch,
        checksum: { list: () => 'sha256sums.asc' },
      });

      expect(version?.files).toMatchObject([{ checksum: `sha256:${hex('d')}`, arch: 'arm64' }]);
    });

    it('reads the checksum from the first sidecar asset which exists', async () => {
      mockReleases([
        withNames('v1.0.0', [
          'tool-linux.tar.gz',
          'tool-linux.tar.gz.sha256',
          'tool-linux.tar.gz.sha512',
        ]),
      ]);
      nock(host)
        .get(`${download}/v1.0.0/tool-linux.tar.gz.sha256`)
        .reply(200, `${hex('e')}  tool-linux.tar.gz\n`);

      const versions = await fetchWith({
        files: () => [{ name: 'tool-linux.tar.gz' }],
        checksum: { sidecar: ['.sha256sum', '.sha256', '.sha512'] },
      });

      expect(versions).toEqual([
        {
          version: '1.0.0',
          files: [
            {
              name: 'tool-linux.tar.gz',
              url: dlUrl('v1.0.0', 'tool-linux.tar.gz'),
              checksum: `sha256:${hex('e')}`,
            },
          ],
        },
      ]);
    });

    it('uses the algorithm of the template', async () => {
      mockReleases([withNames('v1.0.0', ['tool.tgz', 'tool.tgz.sha512'])]);
      nock(host).get(`${download}/v1.0.0/tool.tgz.sha512`).reply(200, 'f'.repeat(128));

      const [version] = await fetchWith({
        files: () => [{ name: 'tool.tgz' }],
        checksum: { sidecar: ['.sha512'] },
        algorithm: 'sha512',
      });

      expect(version?.files).toMatchObject([{ checksum: `sha512:${'f'.repeat(128)}` }]);
    });

    it('skips files without asset or checksum, silently', async () => {
      const output: string[] = [];
      vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
      mockReleases([
        // no arm64 asset, and the list lacks the amd64 file
        withNames('v1.2.0', ['tool_1.2.0_linux_amd64.tar.gz', 'checksums.txt']),
        // the checksum list is missing (404)
        withNames('v1.1.0', ['tool_1.1.0_linux_amd64.tar.gz', 'checksums.txt']),
        // no checksum list asset
        withNames('v1.0.0', ['tool_1.0.0_linux_amd64.tar.gz']),
      ]);
      nock(host)
        .get(`${download}/v1.2.0/checksums.txt`)
        .reply(200, `${hex('a')}  other.tar.gz\n`)
        .get(`${download}/v1.1.0/checksums.txt`)
        .reply(404);

      await expect(
        fetchWith({ files: perArch, checksum: { list: () => 'checksums.txt' } }),
      ).resolves.toEqual([{ version: '1.2.0' }, { version: '1.1.0' }, { version: '1.0.0' }]);
      expect(output).toEqual([]);
    });

    it('reuses the previous files and fetches no list when all files are known', async () => {
      mockReleases([withNames('v1.2.0', ['tool_1.2.0_linux_amd64.tar.gz', 'checksums.txt'])]);
      const known = {
        name: 'tool_1.2.0_linux_amd64.tar.gz',
        url: dlUrl('v1.2.0', 'tool_1.2.0_linux_amd64.tar.gz'),
        checksum: `sha256:${hex('a')}`,
        arch: 'amd64' as const,
      };

      await expect(
        fetchGithubReleases('some/tool', new Set(['1.2.0']), new Map([['1.2.0', [known]]]), {
          files: perArch,
          checksum: { list: () => 'checksums.txt' },
        }),
      ).resolves.toEqual([{ version: '1.2.0', files: [known] }]);
    });

    it('only takes the tags with the prefix and strips it', async () => {
      mockReleases([
        withNames('kustomize/v5.4.1', ['tool_v5.4.1_linux_amd64.tar.gz', 'checksums.txt']),
        withNames('api/v0.17.2', ['checksums.txt']),
        withNames('kustomize/vfoo', []),
        withNames('v9.9.9', []),
      ]);
      nock(host)
        .get(`${download}/kustomize/v5.4.1/checksums.txt`)
        .reply(200, `${hex('a')}  tool_v5.4.1_linux_amd64.tar.gz\n`);

      const versions = await fetchWith({
        tagPrefix: 'kustomize/v',
        files: (v) => [{ arch: 'amd64', name: `tool_v${v}_linux_amd64.tar.gz` }],
        checksum: { list: () => 'checksums.txt' },
      });

      expect(versions).toMatchObject([{ version: '5.4.1', files: [{ arch: 'amd64' }] }]);
      expect(versions).toHaveLength(1);
    });

    describe('computed checksums', () => {
      const sha = (content: string): string =>
        `sha256:${createHash('sha256').update(content).digest('hex')}`;

      /**
       * A release whose assets have a size and optionally a digest.
       * @param tag - the tag
       * @param assets - the asset names with their digest
       */
      function withDigests(
        tag: string,
        assets: Record<string, string | undefined>,
      ): ReturnType<typeof release> & {
        assets: { name: string; browser_download_url: string; digest?: string }[];
      } {
        return {
          ...release(tag),
          assets: Object.entries(assets).map(([name, digest]) => ({
            name,
            browser_download_url: dlUrl(tag, name),
            ...(digest && { digest }),
          })),
        };
      }

      afterEach(() => {
        resetDownloadBudget();
      });

      it('computes the checksum of a file by downloading it, or takes the digest of GitHub', async () => {
        mockReleases([
          withDigests('v1.1.0', { 'tool-linux-amd64': `sha256:${hex('d')}` }),
          withDigests('v1.0.0', { 'tool-linux-amd64': undefined, 'tool-linux-arm64': undefined }),
        ]);
        nock(host)
          .get(`${download}/v1.0.0/tool-linux-amd64`)
          .reply(200, 'amd64 binary', { 'content-length': '12' })
          .get(`${download}/v1.0.0/tool-linux-arm64`)
          .reply(200, 'arm64 binary', { 'content-length': '12' });

        const versions = await fetchWith({
          files: () => [
            { arch: 'amd64', name: 'tool-linux-amd64' },
            { arch: 'arm64', name: 'tool-linux-arm64' },
          ],
          checksum: { compute: true },
        });

        expect(versions).toEqual([
          {
            version: '1.1.0',
            files: [
              {
                name: 'tool-linux-amd64',
                url: dlUrl('v1.1.0', 'tool-linux-amd64'),
                checksum: `sha256:${hex('d')}`,
                arch: 'amd64',
              },
            ],
          },
          {
            version: '1.0.0',
            files: [
              {
                name: 'tool-linux-amd64',
                url: dlUrl('v1.0.0', 'tool-linux-amd64'),
                checksum: sha('amd64 binary'),
                arch: 'amd64',
              },
              {
                name: 'tool-linux-arm64',
                url: dlUrl('v1.0.0', 'tool-linux-arm64'),
                checksum: sha('arm64 binary'),
                arch: 'arm64',
              },
            ],
          },
        ]);
      });

      it('computes only when the release has no checksum asset for the file', async () => {
        mockReleases([
          withNames('v2.0.0', ['tool-linux-amd64', 'checksums.txt']),
          withNames('v1.0.0', ['tool-linux-amd64']),
        ]);
        nock(host)
          .get(`${download}/v2.0.0/checksums.txt`)
          .reply(200, `${hex('a')}  tool-linux-amd64\n`)
          .get(`${download}/v1.0.0/tool-linux-amd64`)
          .reply(200, 'old binary', { 'content-length': '10' });

        const versions = await fetchWith({
          files: () => [{ arch: 'amd64', name: 'tool-linux-amd64' }],
          checksum: { list: () => 'checksums.txt' },
          computeMissing: true,
        });

        expect(versions.map(({ version, files }) => [version, files?.[0]?.checksum])).toEqual([
          ['2.0.0', `sha256:${hex('a')}`],
          ['1.0.0', sha('old binary')],
        ]);
      });

      it('reads all pages, as old releases may still lack a checksum', async () => {
        const page2 = `${api}/repositories/1/releases?per_page=100&page=2`;
        nock(api)
          .get('/repos/some/tool/releases')
          .query({ per_page: '100' })
          .reply(200, [withDigests('v2.0.0', { 'tool-linux-amd64': `sha256:${hex('a')}` })], {
            link: `<${page2}>; rel="next"`,
          })
          .get('/repositories/1/releases')
          .query({ per_page: '100', page: '2' })
          .reply(200, [withDigests('v1.0.0', { 'tool-linux-amd64': `sha256:${hex('b')}` })]);
        const known = {
          name: 'tool-linux-amd64',
          url: dlUrl('v2.0.0', 'tool-linux-amd64'),
          checksum: `sha256:${hex('a')}`,
          arch: 'amd64' as const,
        };

        const versions = await fetchGithubReleases(
          'some/tool',
          new Set(['2.0.0']),
          new Map([['2.0.0', [known]]]),
          {
            files: () => [{ arch: 'amd64', name: 'tool-linux-amd64' }],
            checksum: { compute: true },
          },
        );

        expect(versions.map(({ version }) => version)).toEqual(['2.0.0', '1.0.0']);
      });

      it('prints one line for the tool when the budget is used up', async () => {
        vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '0');
        resetDownloadBudget();
        const output: string[] = [];
        vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
          output.push(String(chunk));
          return true;
        });
        mockReleases([
          withNames('v2.0.0', ['tool-linux-amd64']),
          withNames('v1.0.0', ['tool-linux-amd64']),
        ]);

        await expect(
          fetchWith({
            files: () => [{ arch: 'amd64', name: 'tool-linux-amd64' }],
            checksum: { compute: true },
          }),
        ).resolves.toEqual([{ version: '2.0.0' }, { version: '1.0.0' }]);
        expect(output).toEqual([
          '::notice::some/tool: download budget of the tool used up, the checksums of 2 files will be computed by the next builds\n',
        ]);
      });
    });
  });

  it('fails on an error response', async () => {
    nock(api).get('/repos/helm/helm/releases').query({ per_page: '100' }).reply(403);

    await expect(fetchGithubReleases('helm/helm', none)).rejects.toThrow('failed with status 403');
  });

  describe('nextPage', () => {
    it('returns undefined without a next link', () => {
      expect(nextPage(null)).toBeUndefined();
      expect(nextPage('<https://example.com/1>; rel="prev"')).toBeUndefined();
    });

    it('returns the next link', () => {
      expect(
        nextPage('<https://example.com/1>; rel="prev", <https://example.com/3>; rel="next"'),
      ).toBe('https://example.com/3');
    });
  });
});
