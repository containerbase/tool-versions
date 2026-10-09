import { createHash } from 'node:crypto';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchNpmVersions } from './npm.ts';

describe('datasources/npm', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags prereleases and sorts newest first', async () => {
    const scope = nock('https://registry.npmjs.org')
      .get('/pnpm')
      .reply(200, {
        name: 'pnpm',
        versions: {
          '9.15.0': {},
          '10.0.0-rc.1': {},
          '10.0.0': { deprecated: 'old' },
          '9.2.0': {},
          invalid: {},
        },
      });

    await expect(fetchNpmVersions('pnpm')).resolves.toEqual([
      { version: '10.0.0' },
      { version: '10.0.0-rc.1', prerelease: true },
      { version: '9.15.0' },
      { version: '9.2.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('lists the tarball with the checksum of its integrity', async () => {
    const hash = createHash('sha512').update('tarball').digest();
    const tarball = 'https://registry.npmjs.org/pnpm/-/pnpm-10.0.0.tgz';
    nock('https://registry.npmjs.org')
      .get('/pnpm')
      .reply(200, {
        versions: {
          '10.0.0': { dist: { tarball, integrity: `sha512-${hash.toString('base64')}` } },
          '9.0.0': { dist: { tarball: 'https://registry.npmjs.org/pnpm/-/pnpm-9.0.0.tgz' } },
          '8.0.0': { dist: { tarball: 'x/pnpm-8.0.0.tgz', integrity: 'sha1-abc=' } },
        },
      });

    await expect(fetchNpmVersions('pnpm')).resolves.toEqual([
      {
        version: '10.0.0',
        files: [
          { name: 'pnpm-10.0.0.tgz', url: tarball, checksum: `sha512:${hash.toString('hex')}` },
        ],
      },
      { version: '9.0.0' },
      { version: '8.0.0' },
    ]);
  });

  it('encodes scoped package names', async () => {
    const scope = nock('https://registry.npmjs.org')
      .get('/@yarnpkg%2fcli-dist')
      .reply(200, { versions: { '4.0.0': {} } });

    await expect(fetchNpmVersions('@yarnpkg/cli-dist')).resolves.toEqual([{ version: '4.0.0' }]);
    expect(scope.isDone()).toBe(true);
  });
});
