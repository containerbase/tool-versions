import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchPypiVersions } from './pypi.ts';

const file = { packagetype: 'bdist_wheel', yanked: false };

describe('datasources/pypi', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags prereleases, skips releases without files and sorts by pep440', async () => {
    const scope = nock('https://pypi.org')
      .get('/pypi/poetry/json')
      .reply(200, {
        info: { version: '2.1.0' },
        releases: {
          '2.0.0': [file],
          '2.1.0': [file],
          '2.1.0b1': [file],
          '2.0.1': [{ ...file, yanked: true }],
          '1.10.0': [file],
          '2.2.0.dev1': [file],
          '3.0.0': [],
          'not-a-version': [file],
        },
      });

    await expect(fetchPypiVersions('poetry')).resolves.toEqual([
      { version: '2.2.0.dev1', prerelease: true },
      { version: '2.1.0' },
      { version: '2.1.0b1', prerelease: true },
      { version: '2.0.1' },
      { version: '2.0.0' },
      { version: '1.10.0' },
    ]);
    expect(scope.isDone()).toBe(true);
  });

  it('uses the earliest upload of the files which are not yanked', async () => {
    nock('https://pypi.org')
      .get('/pypi/poetry/json')
      .reply(200, {
        releases: {
          '2.1.0': [
            { upload_time_iso_8601: '2025-03-02T10:00:00.500000Z', yanked: false },
            { upload_time_iso_8601: '2025-03-02T09:00:00.000000Z', yanked: false },
            { upload_time_iso_8601: '2025-03-01T00:00:00.000000Z', yanked: true },
          ],
          '2.0.0': [{ upload_time_iso_8601: '2025-01-01T00:00:00.000000Z', yanked: true }],
          '1.0.0': [{ yanked: false }],
        },
      });

    await expect(fetchPypiVersions('poetry')).resolves.toEqual([
      { version: '2.1.0', releaseTimestamp: '2025-03-02T09:00:00.000Z' },
      { version: '2.0.0' },
      { version: '1.0.0' },
    ]);
  });

  it('normalizes the package name', async () => {
    const scope = nock('https://pypi.org')
      .get('/pypi/pip-tools/json')
      .reply(200, { releases: { '7.0.0': [file] } });

    await expect(fetchPypiVersions('Pip_Tools')).resolves.toEqual([{ version: '7.0.0' }]);
    expect(scope.isDone()).toBe(true);
  });
});
