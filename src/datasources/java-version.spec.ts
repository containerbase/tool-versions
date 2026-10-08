import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchJavaVersions } from './java-version.ts';

const baseUrl = 'https://api.adoptium.net';
const none = new Set<string>();

/**
 * The query of a release versions page.
 * @param imageType - the adoptium image type
 * @param page - the page number
 */
function pageQuery(imageType: string, page: number): Record<string, string> {
  return {
    architecture: 'x64',
    heap_size: 'normal',
    image_type: imageType,
    os: 'linux',
    page: `${page}`,
    page_size: '50',
    project: 'jdk',
    release_type: 'ga',
    sort_order: 'DESC',
  };
}

describe('datasources/java-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags lts majors and sorts newest first', async () => {
    const scope = nock(baseUrl)
      .get('/v3/info/available_releases')
      .reply(200, { available_lts_releases: [8, 11, 17, 21, 25] })
      .get('/v3/info/release_versions')
      .query(pageQuery('jdk', 0))
      .reply(200, {
        versions: [
          { major: 26, semver: '26.0.1+8' },
          { major: 25, semver: '25.0.2+10.0.LTS' },
          { major: 25, semver: '25.0.2+101.0.LTS' },
          { major: 8, semver: '8.0.462+8' },
          { major: 26, semver: 'invalid' },
        ],
      });

    await expect(fetchJavaVersions('java-jdk', none)).resolves.toEqual([
      { version: '26.0.1+8' },
      { version: '25.0.2+101.0.LTS', lts: true },
      { version: '25.0.2+10.0.LTS', lts: true },
      { version: '8.0.462+8', lts: true },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('reads all pages of the jre', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      major: 21,
      semver: `21.0.${i}+1.0.LTS`,
    }));
    const scope = nock(baseUrl)
      .get('/v3/info/available_releases')
      .reply(200, { available_lts_releases: [21] })
      .get('/v3/info/release_versions')
      .query(pageQuery('jre', 0))
      .reply(200, { versions: fullPage })
      .get('/v3/info/release_versions')
      .query(pageQuery('jre', 1))
      .reply(404);

    const versions = await fetchJavaVersions('java-jre', none);

    expect(versions).toHaveLength(50);
    expect(versions[0]).toEqual({ version: '21.0.49+1.0.LTS', lts: true });
    expect(scope.isDone()).toBe(true);
  });

  it('stops paging after a page with a known version', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      major: 21,
      semver: `21.0.${50 - i}+1.0.LTS`,
    }));
    const scope = nock(baseUrl)
      .get('/v3/info/available_releases')
      .reply(200, { available_lts_releases: [21] })
      .get('/v3/info/release_versions')
      .query(pageQuery('jdk', 0))
      .reply(200, { versions: fullPage });

    const versions = await fetchJavaVersions('java-jdk', new Set(['21.0.1+1.0.LTS']));

    expect(versions).toHaveLength(50);
    expect(scope.isDone()).toBe(true);
  });

  it('fails when the first page is missing', async () => {
    nock(baseUrl)
      .get('/v3/info/available_releases')
      .reply(200, { available_lts_releases: [] })
      .get('/v3/info/release_versions')
      .query(pageQuery('jdk', 0))
      .reply(404);

    await expect(fetchJavaVersions('java-jdk', none)).rejects.toThrow('failed with status 404');
  });

  it('fails for an unknown package', async () => {
    await expect(fetchJavaVersions('java-foo', none)).rejects.toThrow(
      'Unknown java package java-foo',
    );
  });
});
