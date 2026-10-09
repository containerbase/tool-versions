import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolFile } from '../schema.ts';
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

/** Answers the asset requests of all features with 404. */
function noAssets(): void {
  nock(baseUrl)
    .persist()
    .get(/^\/v3\/assets\/feature_releases\/\d+\/ga/)
    .reply(404);
}

/**
 * The query of an assets page.
 * @param architecture - the adoptium architecture
 * @param page - the page number
 */
function assetQuery(architecture: string, page: number): Record<string, string> {
  return {
    architecture,
    heap_size: 'normal',
    image_type: 'jdk',
    os: 'linux',
    page: `${page}`,
    page_size: '50',
    project: 'jdk',
    sort_order: 'DESC',
    vendor: 'eclipse',
  };
}

/**
 * An adoptium release with its package.
 * @param semver - the version
 * @param arch - the adoptium architecture
 * @param checksum - the sha256 of the package
 */
function asset(
  semver: string,
  arch: string,
  checksum: string,
): {
  version_data: { semver: string };
  binaries: { architecture: string; package: { name: string; link: string; checksum: string } }[];
} {
  const name = `OpenJDK21U-jdk_${arch}_linux_hotspot_${semver.replace('+', '_').replace(/\.0\.LTS$/, '')}.tar.gz`;
  return {
    version_data: { semver },
    binaries: [
      {
        architecture: arch,
        package: {
          name,
          link: `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/${name}`,
          checksum,
        },
      },
    ],
  };
}

describe('datasources/java-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  describe('files', () => {
    const sha1 = 'a'.repeat(64);
    const sha2 = 'b'.repeat(64);
    const version = '21.0.5+11.0.LTS';

    /**
     * Mocks the version listing with one release.
     * @param versions - the semver versions of feature 21
     */
    function mockVersions(versions: string[]): void {
      nock(baseUrl)
        .get('/v3/info/available_releases')
        .reply(200, { available_lts_releases: [21] })
        .get('/v3/info/release_versions')
        .query(pageQuery('jdk', 0))
        .reply(200, { versions: versions.map((semver) => ({ major: 21, semver })) });
    }

    /** The files of the version. */
    function files(): ToolFile[] {
      const link = (arch: string): string =>
        `https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_${arch}_linux_hotspot_21.0.5_11.tar.gz`;
      return [
        {
          name: 'OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.5_11.tar.gz',
          url: link('aarch64'),
          checksum: `sha256:${sha2}`,
          arch: 'arm64',
        },
        {
          name: 'OpenJDK21U-jdk_x64_linux_hotspot_21.0.5_11.tar.gz',
          url: link('x64'),
          checksum: `sha256:${sha1}`,
          arch: 'amd64',
        },
      ];
    }

    it('reads the x64 and aarch64 files of each feature', async () => {
      mockVersions([version, '21.0.4+7.0.LTS']);
      const scope = nock(baseUrl)
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('x64', 0))
        .reply(200, [asset(version, 'x64', sha1), asset('21.0.4+7.0.LTS', 'x64', sha1)])
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('aarch64', 0))
        .reply(200, [asset(version, 'aarch64', sha2)])
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('aarch64', 1))
        .reply(404);

      const [newest, older] = await fetchJavaVersions('java-jdk', none);

      expect(newest).toEqual({ version, lts: true, files: files() });
      expect(older?.files).toHaveLength(1);
      expect(older?.files?.[0]).toMatchObject({ arch: 'amd64', checksum: `sha256:${sha1}` });
      expect(scope.isDone()).toBe(true);
    });

    it('stops paging once all files are known', async () => {
      mockVersions([version]);
      const scope = nock(baseUrl)
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('x64', 0))
        .reply(200, [asset(version, 'x64', sha1)])
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('aarch64', 0))
        .reply(200, [asset(version, 'aarch64', sha2)]);

      await expect(fetchJavaVersions('java-jdk', none)).resolves.toEqual([
        { version, lts: true, files: files() },
      ]);
      expect(scope.isDone()).toBe(true);
    });

    it('requests only the missing architecture', async () => {
      mockVersions([version]);
      const [x64, aarch64] = [files()[1], files()[0]] as [ToolFile, ToolFile];
      const scope = nock(baseUrl)
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('aarch64', 0))
        .reply(200, [asset(version, 'aarch64', sha2)]);

      await expect(
        fetchJavaVersions('java-jdk', new Set([version]), new Map([[version, [x64]]])),
      ).resolves.toEqual([{ version, lts: true, files: [aarch64, x64] }]);
      expect(scope.isDone()).toBe(true);
    });

    it('makes no request when all files are known', async () => {
      mockVersions([version]);

      await expect(
        fetchJavaVersions('java-jdk', new Set([version]), new Map([[version, files()]])),
      ).resolves.toEqual([{ version, lts: true, files: files() }]);
    });

    it('warns and skips the files when the assets fail', async () => {
      const output: string[] = [];
      vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
      mockVersions([version]);
      nock(baseUrl)
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('x64', 0))
        .reply(500)
        .get('/v3/assets/feature_releases/21/ga')
        .query(assetQuery('aarch64', 0))
        .reply(404);

      await expect(fetchJavaVersions('java-jdk', none)).resolves.toEqual([{ version, lts: true }]);
      expect(output).toEqual([
        `::warning::java: no files for feature 21 (amd64): HttpError: GET ${baseUrl}/v3/assets/feature_releases/21/ga?architecture=x64&heap_size=normal&image_type=jdk&os=linux&page=0&page_size=50&project=jdk&sort_order=DESC&vendor=eclipse failed with status 500\n`,
      ]);
    });
  });

  it('flags lts majors and sorts newest first', async () => {
    noAssets();
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
    noAssets();
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
    noAssets();
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
