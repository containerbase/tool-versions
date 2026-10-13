import { createHash } from 'node:crypto';
import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeChecksum,
  computeChecksumTasks,
  finishToolDownloads,
  remainingDownloadBudget,
  reportSkippedDownloads,
  resetDownloadBudget,
  startToolDownloads,
} from './download.ts';
import type { ToolFile } from './schema.ts';

const host = 'https://files.example.com';

/**
 * The checksum of some content.
 * @param content - the content
 */
function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Mocks a file with its size.
 * @param path - the path of the file
 * @param content - the content
 * @param headers - the response headers, the content length by default
 */
function mockFile(path: string, content: string, headers?: Record<string, string>): void {
  nock(host)
    .get(path)
    .reply(200, content, headers ?? { 'content-length': String(content.length) });
}

describe('download', () => {
  let output: string[];

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    output = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetDownloadBudget();
  });

  describe('computeChecksum', () => {
    it('hashes the downloaded bytes and takes them off the budget', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '1000');
      resetDownloadBudget();
      mockFile('/a.bin', 'some file content');

      await expect(computeChecksum(`${host}/a.bin`)).resolves.toBe(sha256('some file content'));
      expect(remainingDownloadBudget()).toBe(1000 - 'some file content'.length);
    });

    it('hashes a body in many chunks like the whole content', async () => {
      const content = 'x'.repeat(200_000);
      mockFile('/big.bin', content);

      await expect(computeChecksum(`${host}/big.bin`)).resolves.toBe(sha256(content));
    });

    it('does not read a file which is bigger than the budget, by its content length', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '10');
      resetDownloadBudget();
      mockFile('/huge.bin', 'x'.repeat(50));

      await expect(computeChecksum(`${host}/huge.bin`)).resolves.toBeUndefined();
      // nothing was taken off the budget
      expect(remainingDownloadBudget()).toBe(10);
    });

    it('stops streaming when a file without content length exceeds the budget', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '10');
      resetDownloadBudget();
      nock(host).get('/chunked.bin').reply(200, 'x'.repeat(50), { 'transfer-encoding': 'chunked' });

      await expect(computeChecksum(`${host}/chunked.bin`)).resolves.toBeUndefined();
    });

    it('makes no request without a budget', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '0');
      resetDownloadBudget();

      // an unmocked request would fail
      await expect(computeChecksum(`${host}/a.bin`)).resolves.toBeUndefined();
    });

    it.each(['abc', '-5', ''])('uses the default budget for the value %j', (value) => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', value);
      resetDownloadBudget();

      expect(remainingDownloadBudget()).toBe(3 * 1024 ** 3);
    });
  });

  describe('the share of each tool', () => {
    /**
     * Computes the files of a tool in its turn, one after the other.
     * @param label - names the tool
     * @param names - the file names, newest first
     * @returns the names of the files which got a checksum
     */
    async function runTool(label: string, names: string[]): Promise<string[]> {
      startToolDownloads(true);
      const files: ToolFile[] = [];
      for (const task of computeChecksumTasks(
        label,
        names.map((name) => ({ name, url: `${host}/${name}` })),
        files,
      )) {
        await task();
      }
      finishToolDownloads();
      return files.map(({ name }) => name);
    }

    it('splits the budget equally, so a big tool leaves the share of a later small one', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '100');
      resetDownloadBudget(2);
      for (const name of ['big-3', 'big-2', 'big-1', 'small-1']) {
        mockFile(`/${name}`, 'x'.repeat(30));
      }

      // a share is 50 bytes, so only one file of the big tool fits
      await expect(runTool('big', ['big-3', 'big-2', 'big-1'])).resolves.toEqual(['big-3']);
      reportSkippedDownloads('big');
      // the 20 unused bytes go to the next tool, which has 70
      await expect(runTool('small', ['small-1'])).resolves.toEqual(['small-1']);

      expect(output).toEqual([
        '::notice::big: download budget of the tool used up, the checksums of 2 files will be computed by the next builds\n',
      ]);
    });

    it('rolls an unused share over to the next tools, and never exceeds the budget', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '90');
      resetDownloadBudget(3);
      for (const name of ['a-1', 'b-2', 'b-1', 'c-3', 'c-2', 'c-1']) {
        mockFile(`/${name}`, 'x'.repeat(10));
      }
      mockFile('/c-0', 'x'.repeat(10));

      // the shares are 30, then 30 + the 20 left of the first, then everything left
      await expect(runTool('a', ['a-1'])).resolves.toEqual(['a-1']);
      await expect(runTool('b', ['b-2', 'b-1'])).resolves.toEqual(['b-2', 'b-1']);
      // 90 - 10 - 20 = 60 bytes are left for the last tool, which needs only 40 of them
      const downloaded = await runTool('c', ['c-3', 'c-2', 'c-1', 'c-0']);

      expect(downloaded).toEqual(['c-3', 'c-2', 'c-1', 'c-0']);
      // 7 files of 10 bytes are 70 of the 90 bytes
      expect(remainingDownloadBudget()).toBe(0);
    });

    it('lets the total of all tools stay within the budget', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '100');
      resetDownloadBudget(3);
      const names = ['t1', 't2', 't3'].flatMap((tool) =>
        ['5', '4', '3', '2', '1'].map((version) => `${tool}-${version}`),
      );
      for (const name of names) {
        mockFile(`/${name}`, 'x'.repeat(20));
      }

      const counts = [
        (
          await runTool(
            't1',
            names.filter((name) => name.startsWith('t1')),
          )
        ).length,
        (
          await runTool(
            't2',
            names.filter((name) => name.startsWith('t2')),
          )
        ).length,
        (
          await runTool(
            't3',
            names.filter((name) => name.startsWith('t3')),
          )
        ).length,
      ];

      // the first share is 33 bytes, so one file, and the 13 left go to the others: 40 each
      expect(counts).toEqual([1, 2, 2]);
      expect(counts.reduce((sum, count) => sum + count * 20, 0)).toBeLessThanOrEqual(100);
    });

    it('gives a tool which may not compute no share', () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '100');
      resetDownloadBudget(1);

      startToolDownloads(false);

      expect(remainingDownloadBudget()).toBe(0);
      finishToolDownloads();
      startToolDownloads(true);
      expect(remainingDownloadBudget()).toBe(100);
    });
  });

  describe('computeChecksumTasks', () => {
    /**
     * Runs tasks one after the other, which is the order of the queue.
     * @param tasks - the tasks
     */
    async function runInOrder(tasks: (() => Promise<void>)[]): Promise<void> {
      for (const task of tasks) {
        await task();
      }
    }

    it('computes the files which are not known, newest first until the budget is used up', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '25');
      resetDownloadBudget();
      mockFile('/3.0.0.bin', 'x'.repeat(10));
      mockFile('/2.0.0.bin', 'y'.repeat(10));
      mockFile('/1.0.0.bin', 'z'.repeat(10));
      const known: ToolFile = {
        name: '3.0.0.bin',
        url: `${host}/3.0.0.bin`,
        checksum: `sha256:${'0'.repeat(64)}`,
      };
      const newer: ToolFile[] = [];
      const older: ToolFile[] = [];

      await runInOrder([
        ...computeChecksumTasks(
          'tool',
          [{ name: '2.0.0.bin', url: `${host}/2.0.0.bin`, arch: 'amd64' }],
          newer,
        ),
        ...computeChecksumTasks('tool', [{ name: '1.0.0.bin', url: `${host}/1.0.0.bin` }], older),
        // known by name, nothing is downloaded
        ...computeChecksumTasks('tool', [{ name: '3.0.0.bin', url: `${host}/3.0.0.bin` }], [known]),
      ]);

      expect(newer).toEqual([
        {
          name: '2.0.0.bin',
          url: `${host}/2.0.0.bin`,
          checksum: sha256('y'.repeat(10)),
          arch: 'amd64',
        },
      ]);
      expect(older).toEqual([
        { name: '1.0.0.bin', url: `${host}/1.0.0.bin`, checksum: sha256('z'.repeat(10)) },
      ]);
      expect(remainingDownloadBudget()).toBe(5);
    });

    it('skips the files when the budget is used up, with one line per tool', async () => {
      vi.stubEnv('TOOL_VERSIONS_DOWNLOAD_BUDGET', '12');
      resetDownloadBudget();
      mockFile('/a.bin', 'a'.repeat(10));
      mockFile('/b.bin', 'b'.repeat(10));
      mockFile('/c.bin', 'c'.repeat(10));
      const files: ToolFile[] = [];

      await runInOrder([
        ...computeChecksumTasks('first', [{ name: 'a.bin', url: `${host}/a.bin` }], files),
        ...computeChecksumTasks('second', [{ name: 'b.bin', url: `${host}/b.bin` }], files),
        ...computeChecksumTasks('second', [{ name: 'c.bin', url: `${host}/c.bin` }], files),
      ]);
      reportSkippedDownloads('first');
      reportSkippedDownloads('second');
      reportSkippedDownloads('second');

      // the budget is shared by the tools
      expect(files.map(({ name }) => name)).toEqual(['a.bin']);
      expect(output).toEqual([
        '::notice::second: download budget of the tool used up, the checksums of 2 files will be computed by the next builds\n',
      ]);
    });

    it('skips a file with a warning when the download fails', async () => {
      nock(host).get('/a.bin').times(3).reply(500);
      mockFile('/b.bin', 'bb');
      const files: ToolFile[] = [];

      await runInOrder(
        computeChecksumTasks(
          'tool',
          [
            { name: 'a.bin', url: `${host}/a.bin` },
            { name: 'b.bin', url: `${host}/b.bin` },
          ],
          files,
        ),
      );

      expect(files.map(({ name }) => name)).toEqual(['b.bin']);
      expect(output).toEqual([
        `::warning::tool: no checksum computed for ${host}/a.bin: HttpError: GET ${host}/a.bin failed with status 500\n`,
      ]);
    });
  });
});
