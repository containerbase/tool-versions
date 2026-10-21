import nock from 'nock';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTemplate } from '../files.ts';
import type { ToolFile } from '../schema.ts';
import { toolFiles } from '../tools.ts';
import { fetchRustVersions, isExpiredNightly } from './rust-version.ts';

const api = 'https://api.github.com';
const dist = 'https://static.rust-lang.org';
const none = new Set<string>();
const sum = (char: string): string => char.repeat(64);

const rust = toolFiles['rust'];
const template: FileTemplate | undefined = typeof rust === 'function' ? rust : undefined;

/**
 * The line of a manifest in the `manifests.txt`.
 * @param date - the date of the manifest
 * @param channel - the channel or version of the manifest
 */
function manifest(date: string, channel = 'nightly'): string {
  return `static.rust-lang.org/dist/${date}/channel-rust-${channel}.toml`;
}

/**
 * Mocks the checksum files of the archives of a nightly.
 * @param date - the date of the nightly
 * @param char - the character of the digest of the amd64 archive
 * @param arm64 - the status of the arm64 checksum file
 */
function mockNightly(date: string, char: string, arm64 = 200): void {
  nock(dist)
    .get(`/dist/${date}/rust-nightly-x86_64-unknown-linux-gnu.tar.xz.sha256`)
    .reply(200, `${sum(char)}  rust-nightly-x86_64-unknown-linux-gnu.tar.xz\n`)
    .get(`/dist/${date}/rust-nightly-aarch64-unknown-linux-gnu.tar.xz.sha256`)
    .reply(arm64, `${sum('f')}  rust-nightly-aarch64-unknown-linux-gnu.tar.xz\n`);
}

/**
 * The files of a nightly.
 * @param date - the date of the nightly
 * @param char - the character of the digest of the amd64 archive
 */
function nightlyFiles(date: string, char: string): ToolFile[] {
  return [
    {
      name: 'rust-nightly-aarch64-unknown-linux-gnu.tar.xz',
      url: `${dist}/dist/${date}/rust-nightly-aarch64-unknown-linux-gnu.tar.xz`,
      checksum: `sha256:${sum('f')}`,
      arch: 'arm64',
    },
    {
      name: 'rust-nightly-x86_64-unknown-linux-gnu.tar.xz',
      url: `${dist}/dist/${date}/rust-nightly-x86_64-unknown-linux-gnu.tar.xz`,
      checksum: `sha256:${sum(char)}`,
      arch: 'amd64',
    },
  ];
}

/**
 * Mocks the release list of the stable versions, whose archives have no
 * checksum file.
 * @param tags - the tags
 */
function mockStable(...tags: string[]): void {
  for (const tag of tags) {
    nock(dist)
      .get(`/dist/rust-${tag}-x86_64-unknown-linux-gnu.tar.xz.sha256`)
      .reply(404)
      .get(`/dist/rust-${tag}-aarch64-unknown-linux-gnu.tar.xz.sha256`)
      .reply(404);
  }
  nock(api)
    .get('/repos/rust-lang/rust/releases')
    .query({ per_page: '100' })
    .reply(
      200,
      tags.map((tag_name) => ({ tag_name, draft: false, prerelease: false })),
    );
}

describe('datasources/rust-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    nock.cleanAll();
  });

  it('adds the nightlies of the last 90 days as prereleases, newest first before the stable versions', async () => {
    mockStable('1.90.0', '1.89.0');
    nock(dist)
      .get('/manifests.txt')
      .reply(
        200,
        [
          // old nightly, stable and beta manifests and a day without nightly are no new versions
          manifest('2026-01-01'),
          manifest('2026-07-23'),
          manifest('2026-09-30', '1.90.0'),
          manifest('2026-10-01', 'beta'),
          manifest('2026-10-19'),
          manifest('2026-10-19'),
          manifest('2026-10-20'),
          'not a manifest',
          '',
        ].join('\n'),
      );
    mockNightly('2026-07-23', 'a');
    mockNightly('2026-10-19', 'b');
    mockNightly('2026-10-20', 'c', 404);

    const versions = await fetchRustVersions('rust-lang/rust', none, undefined, template);

    expect(versions).toEqual([
      {
        version: 'nightly-2026-10-20',
        prerelease: true,
        releaseTimestamp: '2026-10-20T00:00:00.000Z',
        files: [nightlyFiles('2026-10-20', 'c')[1]],
      },
      {
        version: 'nightly-2026-10-19',
        prerelease: true,
        releaseTimestamp: '2026-10-19T00:00:00.000Z',
        files: nightlyFiles('2026-10-19', 'b'),
      },
      {
        version: 'nightly-2026-07-23',
        prerelease: true,
        releaseTimestamp: '2026-07-23T00:00:00.000Z',
        files: nightlyFiles('2026-07-23', 'a'),
      },
      { version: '1.90.0' },
      { version: '1.89.0' },
    ]);
  });

  it('reuses the known files and only requests the new nightlies', async () => {
    mockStable('1.90.0');
    nock(dist)
      .get('/manifests.txt')
      .reply(200, [manifest('2026-10-19'), manifest('2026-10-20')].join('\n'));
    mockNightly('2026-10-20', 'c');
    // an unmocked request for 2026-10-19 would fail the test
    const known = nightlyFiles('2026-10-19', 'b');

    const versions = await fetchRustVersions(
      'rust-lang/rust',
      new Set(['nightly-2026-10-19']),
      new Map([['nightly-2026-10-19', known]]),
      template,
    );

    expect(versions.map(({ version, files }) => [version, files?.length])).toEqual([
      ['nightly-2026-10-20', 2],
      ['nightly-2026-10-19', 2],
      ['1.90.0', undefined],
    ]);
  });

  it('leaves out the releases older than the minimum version and requests no files without them', async () => {
    mockStable('1.90.0', '1.89.0');
    nock(dist)
      .get('/manifests.txt')
      .reply(200, [manifest('2026-10-19'), manifest('2026-10-20')].join('\n'));

    const versions = await fetchRustVersions(
      'rust-lang/rust',
      none,
      undefined,
      template,
      false,
      undefined,
      'rust-release-channel',
      '1.90.0',
    );

    // the nightlies are newer than any minimum release
    expect(versions.map(({ version }) => version)).toEqual([
      'nightly-2026-10-20',
      'nightly-2026-10-19',
      '1.90.0',
    ]);
  });

  it('fails when the manifest list can not be read', async () => {
    mockStable('1.90.0');
    nock(dist).get('/manifests.txt').reply(404);

    await expect(fetchRustVersions('rust-lang/rust', none)).rejects.toThrow(
      'failed with status 404',
    );
  });

  describe('isExpiredNightly', () => {
    it('expires the nightlies older than 90 days, but no other versions', () => {
      const now = new Date('2026-10-21T12:00:00Z').getTime();

      expect(
        ['nightly-2026-07-22', 'nightly-2026-07-23', 'nightly-2026-10-21', '1.0.0'].map((version) =>
          isExpiredNightly(version, now),
        ),
      ).toEqual([true, false, false, false]);
    });
  });
});
