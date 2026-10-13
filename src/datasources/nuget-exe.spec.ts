import { createHash } from 'node:crypto';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetDownloadBudget } from '../download.ts';
import { fetchNugetExeVersions } from './nuget-exe.ts';

const host = 'https://dist.nuget.org';

/**
 * The checksum of some content.
 * @param content - the content
 */
function sha(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Mocks the `nuget.exe` of a version.
 * @param version - the version
 * @param content - the content of the file
 */
function mockExe(version: string, content: string): void {
  nock(host)
    .get(`/win-x86-commandline/v${version}/nuget.exe`)
    .reply(200, content, { 'content-length': String(content.length) });
}

describe('datasources/nuget-exe', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.unstubAllEnvs();
    resetDownloadBudget();
  });

  it('lists the releases newest first and computes the checksum of nuget.exe', async () => {
    nock(host)
      .get('/tools.json')
      .reply(200, {
        'nuget.exe': [
          { version: '6.11.0', stage: 'ReleasedAndBlessed', uploaded: '2024-08-08T21:40:20Z' },
          { version: '7.0.0-preview.1', stage: 'EarlyAccessPreview' },
          { version: '6.10.2', stage: 'Released' },
          { version: 'not a version', stage: 'Released' },
        ],
      });
    mockExe('7.0.0-preview.1', 'preview');
    mockExe('6.11.0', 'blessed');
    mockExe('6.10.2', 'released');

    const file = (version: string, content: string): object => ({
      name: 'nuget.exe',
      url: `${host}/win-x86-commandline/v${version}/nuget.exe`,
      checksum: sha(content),
    });
    await expect(fetchNugetExeVersions('nuget.exe')).resolves.toEqual([
      { version: '7.0.0-preview.1', prerelease: true, files: [file('7.0.0-preview.1', 'preview')] },
      {
        version: '6.11.0',
        releaseTimestamp: '2024-08-08T21:40:20.000Z',
        files: [file('6.11.0', 'blessed')],
      },
      { version: '6.10.2', files: [file('6.10.2', 'released')] },
    ]);
  });

  it('reuses the known files, and stops with a notice when the budget is used up', async () => {
    vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '10');
    resetDownloadBudget();
    nock(host)
      .get('/tools.json')
      .reply(200, {
        'nuget.exe': [
          { version: '6.11.0', stage: 'ReleasedAndBlessed' },
          { version: '6.10.2', stage: 'Released' },
          { version: '6.9.0', stage: 'Released' },
        ],
      });
    // only the newest of the two unknown versions fits the budget
    mockExe('6.10.2', 'x'.repeat(8));
    mockExe('6.9.0', 'y'.repeat(8));
    const known = {
      name: 'nuget.exe',
      url: `${host}/win-x86-commandline/v6.11.0/nuget.exe`,
      checksum: `sha256:${'0'.repeat(64)}`,
    };

    const versions = await fetchNugetExeVersions(
      'nuget.exe',
      undefined,
      new Map([['6.11.0', [known]]]),
    );

    expect(versions.map(({ version, files }) => [version, files?.[0]?.checksum])).toEqual([
      ['6.11.0', known.checksum],
      ['6.10.2', sha('x'.repeat(8))],
      // without a file until the next build, so the build leaves it out
      ['6.9.0', undefined],
    ]);
  });

  it('fails on an error response', async () => {
    nock(host).get('/tools.json').reply(404);

    await expect(fetchNugetExeVersions('nuget.exe')).rejects.toThrow('failed with status 404');
  });
});
