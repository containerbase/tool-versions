import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ToolVersion } from '../schema.ts';
import { fetchNpmVersions } from './npm.ts';

const registry = 'https://registry.npmjs.org';
const abbreviated = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';

/**
 * Fetches a package, with the versions which have a release time.
 * @param packageName - the npm package name
 * @param hasTimestamp - the versions which already have a release time
 */
async function fetchPackage(
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

/**
 * Fetches the versions of a package, with the versions which have a release time.
 * @param packageName - the npm package name
 * @param hasTimestamp - the versions which already have a release time
 */
async function fetchVersions(packageName: string, hasTimestamp: string[]): Promise<ToolVersion[]> {
  return (await fetchPackage(packageName, hasTimestamp)).versions;
}

describe('datasources/npm', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags prereleases and deprecated versions and sorts newest first', async () => {
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
      { version: '10.0.0', deprecated: true },
      { version: '10.0.0-rc.1', prerelease: true },
      { version: '9.15.0' },
      { version: '9.2.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('returns the latest dist-tag, ignores an empty deprecation', async () => {
    nock(registry)
      .get('/pnpm')
      .reply(200, {
        'dist-tags': { latest: '9.15.0', next: '10.0.0' },
        versions: { '10.0.0': {}, '9.15.0': { deprecated: '' } },
      });

    await expect(fetchPackage('pnpm', ['10.0.0', '9.15.0'])).resolves.toEqual({
      versions: [{ version: '10.0.0' }, { version: '9.15.0' }],
      latest: '9.15.0',
    });
  });

  it.each([
    ['an unlisted version', { 'dist-tags': { latest: 'invalid' } }],
    ['no latest', { 'dist-tags': {} }],
    ['no dist-tags', {}],
    ['invalid dist-tags', { 'dist-tags': ['9.15.0'] }],
  ])('returns no latest for %s', async (_name, tags) => {
    nock(registry)
      .get('/pnpm')
      .reply(200, { ...tags, versions: { '9.15.0': {}, invalid: {} } });

    await expect(fetchPackage('pnpm', ['9.15.0'])).resolves.toEqual({
      versions: [{ version: '9.15.0' }],
    });
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

  it('reads the node constraint from `engines.node` only', async () => {
    nock(registry, { reqheaders: { accept: abbreviated } })
      .get('/npm')
      .reply(200, {
        versions: {
          '12.0.0': {
            engines: { node: '^20.17.0 || >=22.9.0' },
            devEngines: { runtime: { name: 'node', version: '>=99' } },
          },
          '11.0.0': { engines: { node: ' >=20 ' } },
          '10.0.0': { engines: { node: '*' } },
          '9.0.0': { engines: { node: '' } },
          '8.0.0': { engines: { node: 18 } },
          '7.0.0': { engines: ['node'] },
          '6.0.0': { engines: { npm: '>=1' } },
          '5.0.0': { devEngines: { runtime: { name: 'node', version: '>=99' } } },
          '4.0.0': 'broken',
        },
      });

    await expect(
      fetchVersions('npm', [
        '12.0.0',
        '11.0.0',
        '10.0.0',
        '9.0.0',
        '8.0.0',
        '7.0.0',
        '6.0.0',
        '5.0.0',
        '4.0.0',
      ]),
    ).resolves.toEqual([
      { version: '12.0.0', constraints: { node: '^20.17.0 || >=22.9.0' } },
      { version: '11.0.0', constraints: { node: '>=20' } },
      { version: '10.0.0' },
      { version: '9.0.0' },
      { version: '8.0.0' },
      { version: '7.0.0' },
      { version: '6.0.0' },
      { version: '5.0.0' },
      { version: '4.0.0' },
    ]);
  });

  it('encodes scoped package names', async () => {
    const scope = nock(registry)
      .get('/@scope%2ftool')
      .reply(200, { versions: { '4.0.0': {} } });

    await expect(fetchVersions('@scope/tool', ['4.0.0'])).resolves.toEqual([{ version: '4.0.0' }]);
    expect(scope.isDone()).toBe(true);
  });

  it('merges yarn 1 from `yarn` with the later versions from `@yarnpkg/cli-dist`', async () => {
    const scope = nock(registry)
      .get('/@yarnpkg%2fcli-dist')
      .reply(200, { versions: { '4.9.2': {}, '3.8.7': {}, '1.22.22': {}, '2.4.3': {} } })
      .get('/yarn')
      .reply(200, { versions: { '1.22.22': {}, '1.22.21': {}, '1.0.0-rc.1': {}, '2.0.0': {} } });

    await expect(
      fetchVersions('@yarnpkg/cli-dist', [
        '4.9.2',
        '3.8.7',
        '2.4.3',
        '1.22.22',
        '1.22.21',
        '1.0.0-rc.1',
      ]),
    ).resolves.toEqual([
      { version: '4.9.2' },
      { version: '3.8.7' },
      { version: '2.4.3' },
      { version: '1.22.22' },
      { version: '1.22.21' },
      { version: '1.0.0-rc.1', prerelease: true },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('takes the latest dist-tag of `@yarnpkg/cli-dist` for the merged yarn packages', async () => {
    nock(registry)
      .get('/@yarnpkg%2fcli-dist')
      .reply(200, { 'dist-tags': { latest: '4.9.2' }, versions: { '4.9.2': {} } })
      .get('/yarn')
      .reply(200, { 'dist-tags': { latest: '1.22.22' }, versions: { '1.22.22': {} } });

    await expect(fetchPackage('@yarnpkg/cli-dist', ['4.9.2', '1.22.22'])).resolves.toMatchObject({
      latest: '4.9.2',
    });
  });

  it('keeps the constraints of the merged yarn packages', async () => {
    nock(registry)
      .get('/@yarnpkg%2fcli-dist')
      .reply(200, { versions: { '4.9.2': { engines: { node: '>=18.12.0' } } } })
      .get('/yarn')
      .reply(200, { versions: { '1.22.22': { engines: { node: '>=12.22.0' } } } });

    await expect(fetchVersions('@yarnpkg/cli-dist', ['4.9.2', '1.22.22'])).resolves.toEqual([
      { version: '4.9.2', constraints: { node: '>=18.12.0' } },
      { version: '1.22.22', constraints: { node: '>=12.22.0' } },
    ]);
  });

  it('takes all versions of `yarn` for yarn-slim', async () => {
    nock(registry)
      .get('/yarn')
      .reply(200, { versions: { '1.22.22': {} } });

    await expect(fetchVersions('yarn', ['1.22.22'])).resolves.toEqual([{ version: '1.22.22' }]);
  });
});
