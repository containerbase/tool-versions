import { stdout } from 'node:process';

import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchPypiVersions } from './pypi.ts';

const file = { packagetype: 'bdist_wheel', yanked: false };

/**
 * Captures what the code under test writes to stdout, like the GitHub
 * annotations, so they don't reach the test output.
 * @returns the written chunks, filled while the test runs
 */
function captureOutput(): string[] {
  const output: string[] = [];
  vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });
  return output;
}

/**
 * Mocks the poetry releases and the latest release of the mirror plugin.
 * @param requiresDist - the `requires_dist` of the plugin
 */
function mockPoetry(requiresDist: string[] | null): nock.Scope {
  return nock('https://pypi.org')
    .get('/pypi/poetry/json')
    .reply(200, {
      releases: {
        '3.0.0': [file],
        '2.2.0': [{ ...file, yanked: true }],
        '2.1.0': [file],
        '2.2.0b1': [file],
        '1.8.0': [file],
      },
    })
    .get('/pypi/poetry-plugin-pypi-mirror/json')
    .reply(200, { info: { version: '0.6.0', requires_dist: requiresDist } });
}

describe('datasources/pypi', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('flags prereleases, skips releases without files and sorts by pep440', async () => {
    const scope = nock('https://pypi.org')
      .get('/pypi/pdm/json')
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

    await expect(fetchPypiVersions('pdm')).resolves.toEqual({
      versions: [
        { version: '2.2.0.dev1', prerelease: true },
        { version: '2.1.0' },
        { version: '2.1.0b1', prerelease: true },
        { version: '2.0.1', deprecated: true },
        { version: '2.0.0' },
        { version: '1.10.0' },
      ],
    });
    expect(scope.isDone()).toBe(true);
  });

  it('uses the earliest upload of the files which are not yanked', async () => {
    nock('https://pypi.org')
      .get('/pypi/pdm/json')
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

    await expect(fetchPypiVersions('pdm')).resolves.toEqual({
      versions: [
        { version: '2.1.0', releaseTimestamp: '2025-03-02T09:00:00.000Z' },
        { version: '2.0.0', deprecated: true },
        { version: '1.0.0' },
      ],
    });
  });

  it('flags a release as deprecated only when all its files are yanked', async () => {
    nock('https://pypi.org')
      .get('/pypi/pdm/json')
      .reply(200, {
        releases: {
          '3.0.0': [{ yanked: true }, { yanked: true }],
          '2.0.0': [{ yanked: true }, { yanked: false }],
          '1.0.0': [{}],
        },
      });

    await expect(fetchPypiVersions('pdm')).resolves.toEqual({
      versions: [
        { version: '3.0.0', deprecated: true },
        { version: '2.0.0' },
        { version: '1.0.0' },
      ],
    });
  });

  it('reads the python constraint of the first non-yanked file with one', async () => {
    nock('https://pypi.org')
      .get('/pypi/pdm/json')
      .reply(200, {
        releases: {
          '2.1.0': [
            { yanked: true, requires_python: '>=3.1' },
            { yanked: false, requires_python: null },
            { yanked: false, requires_python: ' ' },
            { yanked: false, requires_python: '>=3.9,<4.0' },
            { yanked: false, requires_python: '>=3.8' },
          ],
          '2.0.0': [{ yanked: true, requires_python: '>=3.1' }],
          '1.0.0': [{ yanked: false }],
        },
      });

    await expect(fetchPypiVersions('pdm')).resolves.toEqual({
      versions: [
        { version: '2.1.0', constraints: { python: '>=3.9,<4.0' } },
        { version: '2.0.0', deprecated: true },
        { version: '1.0.0' },
      ],
    });
  });

  it('normalizes the package name', async () => {
    const scope = nock('https://pypi.org')
      .get('/pypi/pip-tools/json')
      .reply(200, { releases: { '7.0.0': [file] } });

    await expect(fetchPypiVersions('Pip_Tools')).resolves.toEqual({
      versions: [{ version: '7.0.0' }],
    });
    expect(scope.isDone()).toBe(true);
  });

  it.each([
    ['with parentheses', ['poetry-core>=1', 'poetry (>=1.2.1,<3.0.0)']],
    ['without parentheses', ['Poetry<3,>=2 ; python_version >= "3.9"']],
  ])(
    'takes the newest stable poetry the mirror plugin requires, %s',
    async (_name, requiresDist) => {
      const scope = mockPoetry(requiresDist);

      const { latest } = await fetchPypiVersions('poetry');

      // 2.2.0 is yanked and 2.2.0b1 a prerelease
      expect(latest).toBe('2.1.0');
      expect(scope.isDone()).toBe(true);
    },
  );

  it.each([
    ['no requirements', null, 'no poetry requirement in the latest poetry-plugin-pypi-mirror'],
    [
      'no poetry requirement',
      ['poetry-core>=1'],
      'no poetry requirement in the latest poetry-plugin-pypi-mirror',
    ],
    [
      'an invalid range',
      ['poetry (not a range)'],
      'no poetry requirement in the latest poetry-plugin-pypi-mirror',
    ],
    [
      'no matching release',
      ['poetry>=4'],
      'no stable release satisfies >=4 of poetry-plugin-pypi-mirror',
    ],
  ])('has no poetry latest for %s', async (_name, requiresDist, warning) => {
    const output = captureOutput();
    mockPoetry(requiresDist);

    const { versions, latest } = await fetchPypiVersions('poetry');

    expect(latest).toBeUndefined();
    expect(versions).toHaveLength(5);
    expect(output).toEqual([`::warning::poetry: ${warning}\n`]);
  });

  it('has no poetry latest when the mirror plugin fails', async () => {
    const output = captureOutput();
    nock('https://pypi.org')
      .get('/pypi/poetry/json')
      .reply(200, { releases: { '2.1.0': [file] } })
      .get('/pypi/poetry-plugin-pypi-mirror/json')
      .reply(404);

    await expect(fetchPypiVersions('poetry')).resolves.toEqual({
      versions: [{ version: '2.1.0' }],
    });
    expect(output).toEqual([
      '::warning::poetry: no latest from poetry-plugin-pypi-mirror: HttpError: GET https://pypi.org/pypi/poetry-plugin-pypi-mirror/json failed with status 404\n',
    ]);
  });
});
