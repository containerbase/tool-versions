import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fetchGradleVersions } from './gradle-version.ts';

const host = 'https://services.gradle.org';
const sum = (char: string): string => char.repeat(64);

/**
 * The published file of a distribution.
 * @param version - the version
 * @param char - the character of the digest
 */
function file(version: string, char: string): { name: string; url: string; checksum: string } {
  const name = `gradle-${version}-bin.zip`;
  return { name, url: `${host}/distributions/${name}`, checksum: `sha256:${sum(char)}` };
}

describe('datasources/gradle-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('lists the releases with the bin zip, its checksum and the build time', async () => {
    nock(host)
      .get('/versions/all')
      .reply(200, [
        { version: '9.0-rc-1', buildTime: '20250601120000+0000', rcFor: '9.0' },
        { version: '8.10', buildTime: '20240802112233+0200' },
        { version: '8.11-milestone-1', milestoneFor: '8.11' },
        { version: '8.11-20240820000000+0000', nightly: true },
        { version: '8.10.1-20240801-snapshot', snapshot: true },
        { version: '8.7', broken: true },
        { version: '7.0' },
        { version: 'not a version!' },
      ])
      .get('/distributions/gradle-9.0-rc-1-bin.zip.sha256')
      .reply(200, sum('a'))
      .get('/distributions/gradle-8.10-bin.zip.sha256')
      .reply(200, `${sum('B')}\n`)
      .get('/distributions/gradle-8.11-milestone-1-bin.zip.sha256')
      .reply(200, sum('c'))
      .get('/distributions/gradle-7.0-bin.zip.sha256')
      .reply(404)
      .get('/versions/current')
      .reply(200, { version: '8.10', current: true });

    await expect(fetchGradleVersions('gradle')).resolves.toEqual({
      latest: '8.10',
      versions: [
        {
          version: '9.0-rc-1',
          prerelease: true,
          releaseTimestamp: '2025-06-01T12:00:00.000Z',
          files: [file('9.0-rc-1', 'a')],
        },
        { version: '8.11-milestone-1', prerelease: true, files: [file('8.11-milestone-1', 'c')] },
        {
          version: '8.10',
          releaseTimestamp: '2024-08-02T09:22:33.000Z',
          files: [file('8.10', 'b')],
        },
        { version: '7.0' },
      ],
    });
  });

  it('reuses the known files without a request', async () => {
    nock(host)
      .get('/versions/all')
      .reply(200, [{ version: '8.10' }])
      .get('/versions/current')
      .reply(200, { version: '8.10' });

    await expect(
      fetchGradleVersions('gradle', undefined, new Map([['8.10', [file('8.10', 'b')]]])),
    ).resolves.toEqual({
      latest: '8.10',
      versions: [{ version: '8.10', files: [file('8.10', 'b')] }],
    });
  });

  it('fetches no files when told so', async () => {
    nock(host)
      .get('/versions/all')
      .reply(200, [{ version: '8.10' }])
      .get('/versions/current')
      .reply(200, { version: '8.10' });

    await expect(
      fetchGradleVersions('gradle', undefined, undefined, undefined, false),
    ).resolves.toEqual({ latest: '8.10', versions: [{ version: '8.10' }] });
  });

  it('has no latest when the current release is not listed', async () => {
    nock(host)
      .get('/versions/all')
      .reply(200, [{ version: '8.10' }, { version: '8.11', broken: true }])
      .get('/versions/current')
      .reply(200, { version: '8.11' });

    const { latest } = await fetchGradleVersions('gradle', undefined, undefined, undefined, false);

    expect(latest).toBeUndefined();
  });

  it('keeps the releases without latest when the current release fails', async () => {
    nock(host)
      .get('/versions/all')
      .reply(200, [{ version: '8.10' }])
      .get('/versions/current')
      .reply(404);

    const result = await fetchGradleVersions('gradle', undefined, undefined, undefined, false);

    expect(result).toEqual({ versions: [{ version: '8.10' }], latest: undefined });
  });

  it('fails on an error response', async () => {
    nock(host)
      .get('/versions/all')
      .reply(404)
      .get('/versions/current')
      .reply(200, { version: '8.10' });

    await expect(fetchGradleVersions('gradle')).rejects.toThrow('failed with status 404');
  });
});
