import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fileNameSafe,
  integrity,
  writeFormats,
  writeIndex,
  writeSchemas,
  writeToolVersions,
} from './output.ts';
import type { ToolFile, ToolVersions } from './schema.ts';

const updatedAt = '2026-10-08T12:00:00.000Z';

/** The url of the schemas of the current format. */
const base = 'https://containerbase.github.io/tool-versions/v1';

/**
 * A file of a version.
 * @param name - the file name
 * @param arch - its architecture
 */
function file(name: string, arch: 'amd64' | 'arm64'): ToolFile {
  return {
    name,
    url: `https://example.com/${name}`,
    checksum: `sha256:${'a'.repeat(64)}`,
    arch,
  };
}

/** A java tool with files, whose versions contain a `+`. */
const java: ToolVersions = {
  tool: 'java',
  homepage: 'https://adoptium.net',
  source: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  updatedAt,
  versions: [
    {
      version: '25.0.4+101.0.LTS',
      lts: true,
      files: [file('jdk-arm64.tar.gz', 'arm64'), file('jdk-x64.tar.gz', 'amd64')],
    },
    { version: '24.0.1+9' },
  ],
};

describe('output', () => {
  let dir: string;
  let output: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tool-versions-'));
    output = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Reads a written file of the output folder.
   * @param name - the file name
   */
  async function read(name: string): Promise<string> {
    return await readFile(join(dir, name), 'utf8');
  }

  it('writes the slim, the full and the per-version files of a tool as a hash chain', async () => {
    const files = await writeToolVersions(dir, java);

    expect((await readdir(dir)).sort()).toEqual([
      'java',
      'java.full.json',
      'java.integrity.json',
      'java.json',
    ]);
    // the per-version file has a literal `+`, only for versions with files
    expect(await readdir(join(dir, 'java'))).toEqual(['25.0.4+101.0.LTS.json']);
    const versionFile = await read('java/25.0.4+101.0.LTS.json');
    expect(JSON.parse(versionFile)).toEqual({
      $schema: `${base}/version.schema.json`,
      tool: 'java',
      version: '25.0.4+101.0.LTS',
      files: java.versions[0]?.files,
    });

    // the integrity file has the integrity of each per-version file
    expect(JSON.parse(await read('java.integrity.json'))).toEqual({
      $schema: `${base}/integrity.schema.json`,
      tool: 'java',
      versions: { '25.0.4+101.0.LTS': integrity(versionFile) },
    });
    // compact, with the `$schema` first and a trailing newline, without the files
    expect(await read('java.json')).toBe(
      '{"$schema":"https://containerbase.github.io/tool-versions/v1/tool.schema.json","tool":"java","homepage":"https://adoptium.net","source":{"datasource":"java-version","packageName":"java-jdk","versioning":"npm"},"updatedAt":"2026-10-08T12:00:00.000Z","versions":[{"version":"25.0.4+101.0.LTS","lts":true},{"version":"24.0.1+9"}]}\n',
    );
    expect(JSON.parse(await read('java.full.json'))).toEqual({
      $schema: `${base}/tool.schema.json`,
      ...java,
    });
    // the index gets the client files with their integrity, not the full file
    expect(files).toEqual({
      slim: { file: 'java.json', integrity: integrity(await read('java.json')) },
      versionFiles: {
        file: 'java.integrity.json',
        integrity: integrity(await read('java.integrity.json')),
      },
    });
  });

  it('removes the per-version files of versions which are gone', async () => {
    await writeToolVersions(dir, java);
    await writeToolVersions(dir, {
      ...java,
      versions: [{ version: '26.0.0+1', files: [file('jdk-x64.tar.gz', 'amd64')] }],
    });

    expect(await readdir(join(dir, 'java'))).toEqual(['26.0.0+1.json']);
  });

  it('formats the integrity like npm', () => {
    expect(integrity('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it('writes no folder for a tool without files', async () => {
    await writeToolVersions(dir, {
      tool: 'pnpm',
      type: 'npm',
      source: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
      updatedAt,
      versions: [{ version: '10.0.0' }, { version: '10.0.0-rc.1', prerelease: true }],
    });

    expect((await readdir(dir)).sort()).toEqual(['pnpm.full.json', 'pnpm.json']);
    expect(await read('pnpm.json')).toBe(await read('pnpm.full.json'));
  });

  it('leaves out a version which is not safe in a file name', async () => {
    await writeToolVersions(dir, {
      ...java,
      versions: [
        { version: '../1.0.0', files: [file('a.tgz', 'amd64')] },
        { version: '2.0.0', files: [file('b.tgz', 'amd64')] },
      ],
    });

    expect(await readdir(join(dir, 'java'))).toEqual(['2.0.0.json']);
    expect(JSON.parse(await read('java.json')).versions).toEqual([{ version: '2.0.0' }]);
    expect(output).toEqual([
      '::warning::java: leaving out versions which are not safe in a file name: ../1.0.0\n',
    ]);
  });

  describe('fileNameSafe', () => {
    it.each(['25.0.4+101.0.LTS', '1.0.0-rc.1', '2026.10.8', '1_0'])('keeps %s', (version) => {
      expect(fileNameSafe('java', [{ version }])).toEqual([{ version }]);
      expect(output).toEqual([]);
    });

    it.each(['a/b', 'a b', '1.0%2B', 'a\\b', 'é'])('leaves out %s', (version) => {
      expect(fileNameSafe('java', [{ version }])).toEqual([]);
      expect(output).toEqual([
        `::warning::java: leaving out versions which are not safe in a file name: ${version}\n`,
      ]);
    });
  });

  it('rejects an invalid tool file', async () => {
    await expect(
      writeToolVersions(dir, {
        tool: 'node',
        source: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
        updatedAt: 'yesterday',
        versions: [],
      }),
    ).rejects.toThrow();
  });

  it('writes the index', async () => {
    const digest = integrity('');
    await writeIndex(dir, {
      updatedAt,
      tools: [
        {
          tool: 'node',
          versionCount: 2,
          slim: { file: 'node.json', integrity: digest },
          versionFiles: { file: 'node.integrity.json', integrity: digest },
        },
      ],
    });

    expect(await read('index.json')).toBe(
      `{"$schema":"${base}/index.schema.json","updatedAt":"2026-10-08T12:00:00.000Z","tools":[{"tool":"node","versionCount":2,"slim":{"file":"node.json","integrity":"${digest}"},"versionFiles":{"file":"node.integrity.json","integrity":"${digest}"}}]}\n`,
    );
  });

  it('replaces the $schema of a previous file', async () => {
    await writeToolVersions(dir, { ...java, $schema: 'https://example.com/old.schema.json' });

    expect(JSON.parse(await read('java.json')).$schema).toBe(`${base}/tool.schema.json`);
  });

  it('writes the root index with the formats and their schema', async () => {
    await writeFormats(dir);

    expect(await read('index.json')).toBe(
      '{"$schema":"https://containerbase.github.io/tool-versions/formats.schema.json","formats":[{"version":1,"path":"v1/","status":"current"}]}\n',
    );
    expect(JSON.parse(await read('formats.schema.json'))).toMatchObject({
      type: 'object',
      required: ['formats'],
    });
  });

  it('writes the json schemas', async () => {
    await writeSchemas(dir);

    expect(JSON.parse(await read('tool.schema.json'))).toMatchObject({
      type: 'object',
      required: ['tool', 'source', 'updatedAt', 'versions'],
    });
    expect(JSON.parse(await read('version.schema.json'))).toMatchObject({
      type: 'object',
      required: ['tool', 'version', 'files'],
    });
    expect(JSON.parse(await read('index.schema.json'))).toMatchObject({
      type: 'object',
      required: ['updatedAt', 'tools'],
    });
  });
});
