import { createHash } from 'node:crypto';
import { stdout } from 'node:process';

import nock from 'nock';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

  beforeEach(() => {
    // the env of the test before is already unstubbed here
    resetDownloadBudget();
  });

  afterEach(() => {
    nock.cleanAll();
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
      // released, but not blessed
      { version: '6.10.2', deprecated: true, files: [file('6.10.2', 'released')] },
    ]);
  });

  it('reuses the known files, and stops with a notice when the budget is used up', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
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
    expect(output).toEqual([
      '::notice::nuget: download budget of the tool used up, the checksums of 1 files will be computed by the next builds\n',
    ]);
  });

  it('lists the releases without files when told so', async () => {
    nock(host)
      .get('/tools.json')
      .reply(200, { 'nuget.exe': [{ version: '6.11.0', stage: 'ReleasedAndBlessed' }] });
    const known = {
      name: 'nuget.exe',
      url: `${host}/win-x86-commandline/v6.11.0/nuget.exe`,
      checksum: `sha256:${'0'.repeat(64)}`,
    };

    await expect(
      fetchNugetExeVersions(
        'nuget.exe',
        undefined,
        new Map([['6.11.0', [known]]]),
        undefined,
        false,
      ),
    ).resolves.toEqual([{ version: '6.11.0' }]);
  });

  it('fails on an error response', async () => {
    nock(host).get('/tools.json').reply(404);

    await expect(fetchNugetExeVersions('nuget.exe')).rejects.toThrow('failed with status 404');
  });
});
