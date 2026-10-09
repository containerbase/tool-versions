import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeIndex, writeSchemas, writeToolVersions } from './output.ts';

const updatedAt = '2026-10-08T12:00:00.000Z';

describe('output', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tool-versions-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Reads a written file of the output folder.
   * @param file - the file name
   */
  async function read(file: string): Promise<string> {
    return await readFile(join(dir, file), 'utf8');
  }

  it('writes a tool file', async () => {
    const file = await writeToolVersions(dir, {
      tool: 'node',
      source: { datasource: 'node-version', packageName: 'node' },
      updatedAt,
      versions: [
        { version: '25.0.0-rc.1', prerelease: true },
        { version: '24.21.0', lts: true },
      ],
    });

    expect(file).toBe('node.json');
    // compact, with a trailing newline
    expect(await read(file)).toBe(
      '{"tool":"node","source":{"datasource":"node-version","packageName":"node"},"updatedAt":"2026-10-08T12:00:00.000Z","versions":[{"version":"25.0.0-rc.1","prerelease":true},{"version":"24.21.0","lts":true}]}\n',
    );
  });

  it('rejects an invalid tool file', async () => {
    await expect(
      writeToolVersions(dir, {
        tool: 'node',
        source: { datasource: 'node-version', packageName: 'node' },
        updatedAt: 'yesterday',
        versions: [],
      }),
    ).rejects.toThrow();
  });

  it('writes the index', async () => {
    await writeIndex(dir, {
      updatedAt,
      tools: [{ tool: 'node', file: 'node.json', versionCount: 2 }],
    });

    expect(await read('index.json')).toBe(
      '{"updatedAt":"2026-10-08T12:00:00.000Z","tools":[{"tool":"node","file":"node.json","versionCount":2}]}\n',
    );
  });

  it('writes a sha512 file next to every json file', async () => {
    await writeToolVersions(dir, {
      tool: 'node',
      source: { datasource: 'node-version', packageName: 'node' },
      updatedAt,
      versions: [{ version: '24.21.0' }],
    });
    await writeIndex(dir, { updatedAt, tools: [] });
    await writeSchemas(dir);

    for (const file of ['node.json', 'index.json', 'tool.schema.json', 'index.schema.json']) {
      const digest = createHash('sha512')
        .update(await readFile(join(dir, file)))
        .digest('hex');
      expect(await read(`${file}.sha512`)).toBe(`${digest}  ${file}\n`);
    }
  });

  it('writes the json schemas', async () => {
    await writeSchemas(dir);

    const tool = JSON.parse(await read('tool.schema.json')) as unknown;
    const index = JSON.parse(await read('index.schema.json')) as unknown;
    expect(tool).toMatchObject({
      type: 'object',
      required: ['tool', 'source', 'updatedAt', 'versions'],
    });
    expect(index).toMatchObject({
      type: 'object',
      required: ['updatedAt', 'tools'],
    });
  });
});
