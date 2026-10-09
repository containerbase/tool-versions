import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchGithubReleases, nextPage } from './github-releases.ts';

const api = 'https://api.github.com';
const none = new Set<string>();

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

  describe('checksums', () => {
    const dl = 'https://github.com/containerbase/python-prebuild/releases/download';
    const repo = 'containerbase/python-prebuild';

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

    it('reads the checksums from the sidecar files', async () => {
      const files = ['a.tar.xz', 'a.tar.xz.sha512', 'b.tar.xz', 'b.tar.xz.sha512', 'c.txt'];
      const scope = nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', files)]);
      const downloads = nock(dl)
        .get('/3.14.8/a.tar.xz.sha512')
        .reply(200, 'ABCDEF12  a.tar.xz\n')
        .get('/3.14.8/b.tar.xz.sha512')
        .reply(200, '0123abcd');

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([
        {
          version: '3.14.8',
          checksums: { 'a.tar.xz': 'sha512:abcdef12', 'b.tar.xz': 'sha512:0123abcd' },
        },
      ]);
      expect(scope.isDone()).toBe(true);
      expect(downloads.isDone()).toBe(true);
    });

    it('leaves out the checksums of releases without sidecar files', async () => {
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz'])]);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
    });

    it('reuses the previous checksums without a download', async () => {
      const checksums = { 'a.tar.xz': 'sha512:abcdef12' };
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [
          withAssets('3.14.8', ['a.tar.xz', 'a.tar.xz.sha512']),
          withAssets('3.14.7', ['b.tar.xz', 'b.tar.xz.sha512']),
        ]);
      const downloads = nock(dl).get('/3.14.7/b.tar.xz.sha512').reply(200, '1234');

      await expect(
        fetchGithubReleases(repo, new Set(['3.14.8']), new Map([['3.14.8', checksums]])),
      ).resolves.toEqual([
        { version: '3.14.8', checksums },
        { version: '3.14.7', checksums: { 'b.tar.xz': 'sha512:1234' } },
      ]);
      expect(downloads.isDone()).toBe(true);
    });

    it('skips the checksum after a failed download and warns', async () => {
      const output: string[] = [];
      vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz', 'a.tar.xz.sha512'])]);
      nock(dl).get('/3.14.8/a.tar.xz.sha512').reply(404);

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
      expect(output).toEqual([
        `::warning::${repo}: no checksum for a.tar.xz: HttpError: GET ${dl}/3.14.8/a.tar.xz.sha512 failed with status 404\n`,
      ]);
    });

    it('skips a checksum file without a digest and warns', async () => {
      const output: string[] = [];
      vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
      nock(api)
        .get(`/repos/${repo}/releases`)
        .query({ per_page: '100' })
        .reply(200, [withAssets('3.14.8', ['a.tar.xz', 'a.tar.xz.sha512'])]);
      nock(dl).get('/3.14.8/a.tar.xz.sha512').reply(200, 'not a digest');

      await expect(fetchGithubReleases(repo, none)).resolves.toEqual([{ version: '3.14.8' }]);
      expect(output).toEqual([
        `::warning::${repo}: no checksum for a.tar.xz: Error: no valid sha512 digest\n`,
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
