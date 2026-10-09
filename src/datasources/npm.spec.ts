import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchNpmVersions } from './npm.ts';

const registry = 'https://registry.npmjs.org';
const abbreviated = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';

/**
 * Fetches the versions of a package, with the versions which have a release time.
 * @param packageName - the npm package name
 * @param hasTimestamp - the versions which already have a release time
 */
async function fetchVersions(
  packageName: string,
  hasTimestamp: string[],
): ReturnType<typeof fetchNpmVersions> {
  return await fetchNpmVersions(
    packageName,
    undefined,
    undefined,
    undefined,
    undefined,
    new Set(hasTimestamp),
  );
}

describe('datasources/npm', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags prereleases and sorts newest first', async () => {
    const scope = nock(registry, { reqheaders: { accept: abbreviated } })
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

    await expect(
      fetchVersions('pnpm', ['9.15.0', '10.0.0-rc.1', '10.0.0', '9.2.0']),
    ).resolves.toEqual([
      { version: '10.0.0' },
      { version: '10.0.0-rc.1', prerelease: true },
      { version: '9.15.0' },
      { version: '9.2.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('only requests the abbreviated document when all versions have a release time', async () => {
    // an unmocked request to the full document would fail
    const scope = nock(registry, { reqheaders: { accept: abbreviated } })
      .get('/pnpm')
      .reply(200, { versions: { '10.0.0': {}, '9.0.0': {} } });

    await expect(fetchVersions('pnpm', ['10.0.0', '9.0.0'])).resolves.toEqual([
      { version: '10.0.0' },
      { version: '9.0.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('reads the release time of new versions from the full document', async () => {
    const abbreviatedScope = nock(registry, { reqheaders: { accept: abbreviated } })
      .get('/pnpm')
      .reply(200, { versions: { '10.0.0': {}, '9.0.0': {} } });
    const fullScope = nock(registry, { reqheaders: { accept: 'application/json' } })
      .get('/pnpm')
      .reply(200, {
        versions: { '10.0.0': {}, '9.0.0': {} },
        time: {
          created: '2014-01-01T00:00:00.000Z',
          modified: '2025-02-01T00:00:00.000Z',
          '10.0.0': '2025-01-15T10:20:30.123Z',
          '9.0.0': '2024-01-01T00:00:00.000Z',
        },
      });

    await expect(fetchVersions('pnpm', ['9.0.0'])).resolves.toEqual([
      { version: '10.0.0', releaseTimestamp: '2025-01-15T10:20:30.123Z' },
      { version: '9.0.0' },
    ]);
    expect(abbreviatedScope.isDone()).toBe(true);
    expect(fullScope.isDone()).toBe(true);
  });

  it('encodes scoped package names', async () => {
    const scope = nock(registry)
      .get('/@yarnpkg%2fcli-dist')
      .reply(200, { versions: { '4.0.0': {} } });

    await expect(fetchVersions('@yarnpkg/cli-dist', ['4.0.0'])).resolves.toEqual([
      { version: '4.0.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });
});
