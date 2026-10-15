import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FileTemplate } from '../files.ts';
import { fetchDartVersions } from './dart-version.ts';

const host = 'https://storage.googleapis.com';
const listing = '/storage/v1/b/dart-archive/o';
const sum = (char: string): string => char.repeat(64);

/**
 * The query of a listing page.
 * @param pageToken - the token of the page
 */
function query(pageToken?: string): Record<string, string> {
  return {
    alt: 'json',
    delimiter: '/',
    prefix: 'channels/stable/release/',
    ...(pageToken && { pageToken }),
  };
}

/** One amd64 zip per version, with its sha256sum file. */
const template: FileTemplate = (version) => {
  const name = 'dartsdk-linux-x64-release.zip';
  const url = `${host}/dart-archive/channels/stable/release/${version}/sdk/${name}`;
  return [{ name, url, checksumUrls: [`${url}.sha256sum`], algorithm: 'sha256', arch: 'amd64' }];
};

describe('datasources/dart-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('pages the release folders and reads the checksums of the sdk zips', async () => {
    nock(host)
      .get(listing)
      .query(query())
      .reply(200, {
        prefixes: ['channels/stable/release/2.19.4/', 'channels/stable/release/latest/'],
        nextPageToken: 'next',
      })
      .get(listing)
      .query(query('next'))
      .reply(200, { prefixes: ['channels/stable/release/3.5.0/', 'channels/stable/release/1.x/'] })
      .get(
        '/dart-archive/channels/stable/release/2.19.4/sdk/dartsdk-linux-x64-release.zip.sha256sum',
      )
      .reply(200, `${sum('a')} *dartsdk-linux-x64-release.zip\n`)
      .get(
        '/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-x64-release.zip.sha256sum',
      )
      .reply(404);

    await expect(fetchDartVersions('dart', undefined, undefined, template)).resolves.toEqual([
      { version: '3.5.0' },
      {
        version: '2.19.4',
        files: [
          {
            name: 'dartsdk-linux-x64-release.zip',
            url: `${host}/dart-archive/channels/stable/release/2.19.4/sdk/dartsdk-linux-x64-release.zip`,
            checksum: `sha256:${sum('a')}`,
            arch: 'amd64',
          },
        ],
      },
    ]);
  });

  it('skips the releases older than the minimum version without requesting their checksums', async () => {
    nock(host)
      .get(listing)
      .query(query())
      .reply(200, {
        prefixes: ['channels/stable/release/3.5.0/', 'channels/stable/release/1.24.3/'],
      })
      .get(
        '/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-x64-release.zip.sha256sum',
      )
      .reply(200, `${sum('c')} *dartsdk-linux-x64-release.zip\n`);
    // an unmocked request of the checksum of 1.24.3 would fail the test

    const versions = await fetchDartVersions(
      'dart',
      undefined,
      undefined,
      template,
      true,
      undefined,
      'semver',
      '2.0.0',
    );

    expect(versions.map(({ version }) => version)).toEqual(['3.5.0']);
  });

  it('reuses the known files without a request', async () => {
    nock(host)
      .get(listing)
      .query(query())
      .reply(200, { prefixes: ['channels/stable/release/3.5.0/'] });
    const known = {
      name: 'dartsdk-linux-x64-release.zip',
      url: `${host}/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-x64-release.zip`,
      checksum: `sha256:${sum('b')}`,
      arch: 'amd64' as const,
    };

    await expect(
      fetchDartVersions('dart', undefined, new Map([['3.5.0', [known]]]), template),
    ).resolves.toEqual([{ version: '3.5.0', files: [known] }]);
  });

  it('fails on an error response', async () => {
    nock(host).get(listing).query(query()).reply(404);

    await expect(fetchDartVersions('dart')).rejects.toThrow('failed with status 404');
  });
});
