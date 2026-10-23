import { createHash } from 'node:crypto';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetDownloadBudget } from '../download.ts';
import { fetchSwiftReleases } from './swift-releases.ts';

const site = 'https://www.swift.org';
const host = 'https://download.swift.org';

/**
 * The checksum of some content.
 * @param content - the content
 */
function sha(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Mocks the download of an archive.
 * @param path - the path on download.swift.org
 * @param content - the content of the archive
 */
function mockArchive(path: string, content: string): void {
  nock(host)
    .get(path)
    .reply(200, content, { 'content-length': String(content.length) });
}

/**
 * A platform of a release, as swift.org lists it.
 * @param name - the name, like `Ubuntu 22.04`
 * @param archs - the architectures
 */
function platform(
  name: string,
  archs = ['x86_64', 'aarch64'],
): { name: string; platform: string; archs: string[] } {
  return { name, platform: 'Linux', archs };
}

describe('datasources/swift-releases', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.unstubAllEnvs();
    resetDownloadBudget();
  });

  it('lists the archives of Ubuntu 22.04, 24.04 and 26.04 with the urls of the cli', async () => {
    nock(site)
      .get('/api/v1/install/releases.json')
      .reply(200, [
        {
          name: '6.4.0',
          tag: 'swift-6.4-RELEASE',
          date: '2026-09-15',
          platforms: [platform('Ubuntu 22.04'), platform('Ubuntu 26.04'), platform('macOS')],
        },
        // releases before 6.4 drop the `.0` patch from the urls, and the
        // platforms which are no longer supported are ignored
        {
          name: '6.0',
          date: '2024-09-17',
          platforms: [
            platform('Ubuntu 18.04', ['x86_64']),
            platform('Ubuntu 20.04'),
            platform('Ubuntu 22.04', ['x86_64']),
            platform('Ubuntu 24.04', ['x86_64']),
          ],
        },
        // before 5.10.1 there are no Ubuntu 24.04 archives
        {
          name: '5.9.2',
          date: '2023-12-11',
          platforms: [platform('Ubuntu 20.04'), platform('Ubuntu 22.04', ['x86_64'])],
        },
      ]);
    mockArchive(
      '/swift-6.4.0-release/ubuntu2204/swift-6.4.0-RELEASE/swift-6.4.0-RELEASE-ubuntu22.04.tar.gz',
      'a',
    );
    mockArchive(
      '/swift-6.4.0-release/ubuntu2204-aarch64/swift-6.4.0-RELEASE/swift-6.4.0-RELEASE-ubuntu22.04-aarch64.tar.gz',
      'b',
    );
    mockArchive(
      '/swift-6.4.0-release/ubuntu2604/swift-6.4.0-RELEASE/swift-6.4.0-RELEASE-ubuntu26.04.tar.gz',
      'c',
    );
    mockArchive(
      '/swift-6.4.0-release/ubuntu2604-aarch64/swift-6.4.0-RELEASE/swift-6.4.0-RELEASE-ubuntu26.04-aarch64.tar.gz',
      'd',
    );
    mockArchive(
      '/swift-6.0-release/ubuntu2204/swift-6.0-RELEASE/swift-6.0-RELEASE-ubuntu22.04.tar.gz',
      'e',
    );
    mockArchive(
      '/swift-6.0-release/ubuntu2404/swift-6.0-RELEASE/swift-6.0-RELEASE-ubuntu24.04.tar.gz',
      'f',
    );
    mockArchive(
      '/swift-5.9.2-release/ubuntu2204/swift-5.9.2-RELEASE/swift-5.9.2-RELEASE-ubuntu22.04.tar.gz',
      'g',
    );
    const file = (
      path: string,
      name: string,
      content: string,
      arch: 'amd64' | 'arm64',
      distro: 'jammy' | 'noble' | 'resolute',
    ): object => ({
      name,
      url: `${host}/${path}/${name}`,
      checksum: sha(content),
      arch,
      distro,
    });

    await expect(fetchSwiftReleases()).resolves.toEqual([
      {
        version: '6.4.0',
        releaseTimestamp: '2026-09-15T00:00:00.000Z',
        // sorted by name
        files: [
          // the archive of 22.04 is the jammy one, which the cli also uses on noble
          file(
            'swift-6.4.0-release/ubuntu2204-aarch64/swift-6.4.0-RELEASE',
            'swift-6.4.0-RELEASE-ubuntu22.04-aarch64.tar.gz',
            'b',
            'arm64',
            'jammy',
          ),
          file(
            'swift-6.4.0-release/ubuntu2204/swift-6.4.0-RELEASE',
            'swift-6.4.0-RELEASE-ubuntu22.04.tar.gz',
            'a',
            'amd64',
            'jammy',
          ),
          file(
            'swift-6.4.0-release/ubuntu2604-aarch64/swift-6.4.0-RELEASE',
            'swift-6.4.0-RELEASE-ubuntu26.04-aarch64.tar.gz',
            'd',
            'arm64',
            'resolute',
          ),
          file(
            'swift-6.4.0-release/ubuntu2604/swift-6.4.0-RELEASE',
            'swift-6.4.0-RELEASE-ubuntu26.04.tar.gz',
            'c',
            'amd64',
            'resolute',
          ),
        ],
      },
      {
        version: '6.0',
        releaseTimestamp: '2024-09-17T00:00:00.000Z',
        files: [
          file(
            'swift-6.0-release/ubuntu2204/swift-6.0-RELEASE',
            'swift-6.0-RELEASE-ubuntu22.04.tar.gz',
            'e',
            'amd64',
            'jammy',
          ),
          // noble has its own archive from 5.10.1 on
          file(
            'swift-6.0-release/ubuntu2404/swift-6.0-RELEASE',
            'swift-6.0-RELEASE-ubuntu24.04.tar.gz',
            'f',
            'amd64',
            'noble',
          ),
        ],
      },
      {
        // only the jammy archive, which noble falls back to
        version: '5.9.2',
        releaseTimestamp: '2023-12-11T00:00:00.000Z',
        files: [
          file(
            'swift-5.9.2-release/ubuntu2204/swift-5.9.2-RELEASE',
            'swift-5.9.2-RELEASE-ubuntu22.04.tar.gz',
            'g',
            'amd64',
            'jammy',
          ),
        ],
      },
    ]);
  });

  it('skips the releases older than the minimum version without downloading them', async () => {
    nock(site)
      .get('/api/v1/install/releases.json')
      .reply(200, [
        { name: '5.6.3', platforms: [platform('Ubuntu 22.04', ['x86_64'])] },
        { name: '5.7', platforms: [platform('Ubuntu 22.04', ['x86_64'])] },
        { name: 'not a version', platforms: [] },
      ]);
    // an unmocked download of 5.6.3 would fail the test
    mockArchive(
      '/swift-5.7-release/ubuntu2204/swift-5.7-RELEASE/swift-5.7-RELEASE-ubuntu22.04.tar.gz',
      'x',
    );

    const versions = await fetchSwiftReleases(
      'swift',
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      'semver-coerced',
      '5.7',
    );

    expect(versions.map(({ version, files }) => [version, files?.length])).toEqual([['5.7', 1]]);
  });

  it('computes the newest releases first and reuses the known files', async () => {
    vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '10');
    resetDownloadBudget();
    nock(site)
      .get('/api/v1/install/releases.json')
      .reply(200, [
        { name: '6.0.1', platforms: [platform('Ubuntu 22.04', ['x86_64'])] },
        { name: '6.0.3', platforms: [platform('Ubuntu 22.04', ['x86_64'])] },
        { name: '6.0.2', platforms: [platform('Ubuntu 22.04', ['x86_64'])] },
        { name: '6.1.0', platforms: [platform('Ubuntu 22.04', ['x86_64'])] },
      ]);
    // only the newest of the unknown releases fits the budget, 6.1.0 is known
    mockArchive(
      '/swift-6.0.3-release/ubuntu2204/swift-6.0.3-RELEASE/swift-6.0.3-RELEASE-ubuntu22.04.tar.gz',
      'x'.repeat(8),
    );
    // the unknown releases beyond the budget are only requested, not read
    for (const version of ['6.0.2', '6.0.1']) {
      mockArchive(
        `/swift-${version}-release/ubuntu2204/swift-${version}-RELEASE/swift-${version}-RELEASE-ubuntu22.04.tar.gz`,
        'y'.repeat(8),
      );
    }
    // 6.1.0 is listed as 6.1 in the names of the files, as before 6.4
    const known = {
      name: 'swift-6.1-RELEASE-ubuntu22.04.tar.gz',
      url: `${host}/swift-6.1-release/ubuntu2204/swift-6.1-RELEASE/swift-6.1-RELEASE-ubuntu22.04.tar.gz`,
      checksum: `sha256:${'0'.repeat(64)}`,
      arch: 'amd64' as const,
    };

    const versions = await fetchSwiftReleases('swift', undefined, new Map([['6.1.0', [known]]]));

    expect(versions.map(({ version, files }) => [version, files?.[0]?.checksum])).toEqual([
      ['6.1.0', known.checksum],
      ['6.0.3', sha('x'.repeat(8))],
      // without a file until the next build
      ['6.0.2', undefined],
      ['6.0.1', undefined],
    ]);
  });

  it('publishes no files when told so, and skips a missing archive silently', async () => {
    nock(site)
      .get('/api/v1/install/releases.json')
      .reply(200, [{ name: '6.0.3', platforms: [platform('Ubuntu 22.04', ['x86_64'])] }]);

    await expect(
      fetchSwiftReleases('swift', undefined, undefined, undefined, false),
    ).resolves.toEqual([{ version: '6.0.3' }]);

    nock(site)
      .get('/api/v1/install/releases.json')
      .reply(200, [{ name: '6.0.3', platforms: [platform('Ubuntu 22.04', ['x86_64'])] }]);
    nock(host)
      .get(
        '/swift-6.0.3-release/ubuntu2204/swift-6.0.3-RELEASE/swift-6.0.3-RELEASE-ubuntu22.04.tar.gz',
      )
      .reply(404);

    await expect(fetchSwiftReleases()).resolves.toEqual([{ version: '6.0.3' }]);
  });

  it('fails on an error response', async () => {
    nock(site).get('/api/v1/install/releases.json').reply(404);

    await expect(fetchSwiftReleases()).rejects.toThrow('failed with status 404');
  });
});
