import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchNugetVersions } from './nuget.ts';

describe('datasources/nuget', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('requests the lowercase id, flags prereleases and sorts newest first', async () => {
    const scope = nock('https://api.nuget.org')
      .get('/v3-flatcontainer/paket/index.json')
      .reply(200, {
        versions: [
          '9.0.2',
          '10.0.0-beta.2',
          '10.0.0-beta.10',
          '10.0.0-alpha.1',
          '5.257.0',
          '5.257.0.1',
          '10.0.0',
          'not a version',
        ],
      });

    await expect(fetchNugetVersions('Paket')).resolves.toEqual([
      { version: '10.0.0' },
      { version: '10.0.0-beta.10', prerelease: true },
      { version: '10.0.0-beta.2', prerelease: true },
      { version: '10.0.0-alpha.1', prerelease: true },
      { version: '9.0.2' },
      { version: '5.257.0.1' },
      { version: '5.257.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('fails on an error response', async () => {
    nock('https://api.nuget.org').get('/v3-flatcontainer/paket/index.json').reply(404);

    await expect(fetchNugetVersions('Paket')).rejects.toThrow('failed with status 404');
  });
});
