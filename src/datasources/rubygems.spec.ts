import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchRubygemsVersions } from './rubygems.ts';

describe('datasources/rubygems', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags prereleases, reads the release time and sorts like gem versions', async () => {
    const scope = nock('https://rubygems.org')
      .get('/api/v1/versions/bundler.json')
      .reply(200, [
        { number: '2.6.0.rc1', prerelease: true, created_at: '2025-01-02T03:04:05.678Z' },
        { number: '2.5.10', prerelease: false, created_at: '2025-01-01T00:00:00.000Z' },
        { number: '2.5.9', prerelease: false, created_at: '2024-12-31T10:00:00.000+01:00' },
        { number: '2.5.9', prerelease: false, created_at: '2024-12-30T10:00:00.000Z' },
        { number: '1.17.3', prerelease: false },
        { number: 'not a version', prerelease: false, created_at: '2025-01-01T00:00:00.000Z' },
      ]);

    await expect(fetchRubygemsVersions('bundler')).resolves.toEqual([
      { version: '2.6.0.rc1', prerelease: true, releaseTimestamp: '2025-01-02T03:04:05.678Z' },
      { version: '2.5.10', releaseTimestamp: '2025-01-01T00:00:00.000Z' },
      { version: '2.5.9', releaseTimestamp: '2024-12-31T09:00:00.000Z' },
      { version: '1.17.3' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('fails on an error response', async () => {
    nock('https://rubygems.org').get('/api/v1/versions/bundler.json').reply(404);

    await expect(fetchRubygemsVersions('bundler')).rejects.toThrow('failed with status 404');
  });
});
