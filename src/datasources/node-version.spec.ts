import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchNodeVersions } from './node-version.ts';

describe('datasources/node-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('drops the v, flags lts releases and sorts newest first', async () => {
    const scope = nock('https://nodejs.org')
      .get('/dist/index.json')
      .reply(200, [
        { version: 'v24.21.0', lts: 'Krypton' },
        { version: 'v25.1.0', lts: false },
        { version: 'v25.10.0', lts: false },
        { version: 'v0.1.14', lts: false },
        { version: 'invalid', lts: false },
      ]);

    await expect(fetchNodeVersions('node')).resolves.toEqual([
      { version: '25.10.0' },
      { version: '25.1.0' },
      { version: '24.21.0', lts: true },
      { version: '0.1.14' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('fails on an error response', async () => {
    nock('https://nodejs.org').get('/dist/index.json').reply(500);

    await expect(fetchNodeVersions('node')).rejects.toThrow(
      'GET https://nodejs.org/dist/index.json failed with status 500',
    );
  });
});
