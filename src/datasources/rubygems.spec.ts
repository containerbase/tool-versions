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

  it('reads the ruby constraint and skips the one which accepts any ruby', async () => {
    nock('https://rubygems.org')
      .get('/api/v1/versions/bundler.json')
      .reply(200, [
        { number: '2.6.0', prerelease: false, ruby_version: '>= 3.1.0' },
        { number: '2.5.0', prerelease: false, ruby_version: '>= 0' },
        { number: '2.4.0', prerelease: false, ruby_version: null },
        { number: '2.3.0', prerelease: false, ruby_version: '' },
        { number: '2.2.0', prerelease: false },
      ]);

    await expect(fetchRubygemsVersions('bundler')).resolves.toEqual([
      { version: '2.6.0', constraints: { ruby: '>= 3.1.0' } },
      { version: '2.5.0' },
      { version: '2.4.0' },
      { version: '2.3.0' },
      { version: '2.2.0' },
    ]);
  });

  it('fails on an error response', async () => {
    nock('https://rubygems.org').get('/api/v1/versions/bundler.json').reply(404);

    await expect(fetchRubygemsVersions('bundler')).rejects.toThrow('failed with status 404');
  });
});
