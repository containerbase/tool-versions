import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileTemplate } from '../files.ts';
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
      nock(dl).get('/3.14.8/a.tar.xz.sha512').reply(500);

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
