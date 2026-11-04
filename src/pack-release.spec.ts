import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type PackOptions, packRelease } from './pack-release.ts';

const buildTime = '2026-10-15T03:00:00.000Z';

/**
 * A slim tool file, as written by the build.
 * @param versions - the versions
 */
function toolFile(versions: string[]): string {
  return JSON.stringify({
    tool: 'helm',
    updatedAt: buildTime,
    versions: versions.map((version) => ({ version })),
  });
}

describe('pack-release', () => {
  let dir: string;
  let output: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tool-versions-pack-'));
    output = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Writes files below the temporary folder.
   * @param files - the content by path
   */
  async function write(files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  }

  /**
   * Reads a file below the temporary folder.
   * @param path - the path of the file
   */
  async function read(path: string): Promise<string> {
    return await readFile(join(dir, path), 'utf8');
  }

  /**
   * The options of a pack step for the folders of the test.
   * @param options - the options to change
   */
  function options(options: Partial<PackOptions> = {}): PackOptions {
    return {
      from: join(dir, 'dist'),
      to: join(dir, 'out'),
      published: [],
      releaseOn: 'any',
      ...options,
    };
  }

  /** The build output with one version of a tool. */
  const build = {
    'dist/index.json': '{"formats":[]}\n',
    'dist/v1/index.json': `{"updatedAt":"${buildTime}","tools":[]}`,
    'dist/v1/helm.json': toolFile(['3.19.0']),
    // not a client file
    'dist/summary.md': '# summary',
  };

  it('packs the first release, with its notes, summary and outputs', async () => {
    await write({ ...build, 'commits.txt': 'feat: first (#1)\n\nchore: a\n' });

    await packRelease(
      options({
        commits: join(dir, 'commits.txt'),
        summary: join(dir, 'summary.md'),
        githubOutput: join(dir, 'github-output'),
      }),
    );

    expect((await readdir(join(dir, 'out'))).sort()).toEqual([
      'release-notes.md',
      'tool-versions-1.0.0.tar.xz',
      'tool-versions-1.0.0.tar.xz.sha512',
    ]);
    expect(JSON.parse(await read('dist/release.json'))).toMatchObject({
      version: '1.0.0',
      buildTime,
    });
    const notes = await read('out/release-notes.md');
    expect(notes).toMatch(/^## 1\.0\.0 \(\d{4}-\d\d-\d\d\)\n/);
    expect(notes).toContain('- `helm`: new tool with 1 version');
    expect(notes).toContain('- first (#1)');
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(
      /out\/tool-versions-1\.0\.0\.tar\.xz: 4 files, \d+ bytes packed, \d+ bytes unpacked, version 1\.0\.0\n$/,
    );
    expect(await read('summary.md')).toMatch(/^### Release archive 1\.0\.0\n\n4 files, /);
    expect(await read('github-output')).toBe(
      'changed=true\nversion=1.0.0\nbreaking=false\nerror=\n',
    );
  });

  it('plans the next version from the published ones and the commits', async () => {
    await write({
      ...build,
      'previous/index.json': '{"formats":[]}\n',
      'previous/v1/helm.json': toolFile(['3.18.0']),
      'commits.txt': 'feat: a\n',
    });

    await packRelease(
      options({
        published: ['v1.2.3', 'v1.1.0'],
        previous: join(dir, 'previous'),
        commits: join(dir, 'commits.txt'),
        githubOutput: join(dir, 'github-output'),
      }),
    );

    expect(await readdir(join(dir, 'out'))).toContain('tool-versions-1.3.0.tar.xz');
    expect(JSON.parse(await read('dist/release.json'))).toMatchObject({ version: '1.3.0' });
    expect(await read('github-output')).toContain('changed=true\nversion=1.3.0\n');
  });

  it('is not due without a change of the data, the release.json has the latest version', async () => {
    await write({
      ...build,
      'previous/index.json': '{"formats":[]}\n',
      'previous/v1/index.json': '{"updatedAt":"2026-10-14T03:00:00.000Z","tools":[]}',
      'previous/v1/helm.json': toolFile(['3.19.0']),
    });

    await packRelease(
      options({
        published: ['v1.0.4'],
        previous: join(dir, 'previous'),
        githubOutput: join(dir, 'github-output'),
      }),
    );

    expect(JSON.parse(await read('dist/release.json'))).toMatchObject({ version: '1.0.4' });
    expect(await read('github-output')).toBe(
      'changed=false\nversion=1.0.5\nbreaking=false\nerror=\n',
    );
    expect(await read('out/release-notes.md')).toMatch(/^## 1\.0\.5 \(\d{4}-\d\d-\d\d\)\n$/);
  });

  it('has the version of the next release when nothing was published and nothing changed', async () => {
    await write({
      ...build,
      'previous/index.json': '{"formats":[]}\n',
      'previous/v1/index.json': `{"updatedAt":"${buildTime}","tools":[]}`,
      'previous/v1/helm.json': toolFile(['3.19.0']),
    });

    await packRelease(options({ previous: join(dir, 'previous') }));

    expect(JSON.parse(await read('dist/release.json'))).toMatchObject({ version: '1.0.0' });
  });

  it('uses the current time as build time without an index of the format', async () => {
    await write({ 'dist/index.json': '{"formats":[]}\n' });

    await packRelease(options());

    const { buildTime: time } = JSON.parse(await read('dist/release.json'));
    expect(new Date(time).toISOString()).toBe(time);
    expect(Date.now() - new Date(time).getTime()).toBeLessThan(60_000);
  });

  it.each([
    ['chore: update the data', false],
    ['not conventional', false],
    ['fix: a tool', true],
  ])(
    'releases a change of the data only for a release commit with `code`: %s',
    async (commit, due) => {
      await write({
        ...build,
        'previous/index.json': '{"formats":[]}\n',
        'previous/v1/helm.json': toolFile(['3.18.0']),
        'commits.txt': `${commit}\n`,
      });

      await packRelease(
        options({
          published: ['v1.0.0'],
          previous: join(dir, 'previous'),
          commits: join(dir, 'commits.txt'),
          githubOutput: join(dir, 'github-output'),
          releaseOn: 'code',
        }),
      );

      expect(await read('github-output')).toBe(
        `changed=${due}\nversion=1.0.1\nbreaking=false\nerror=\n`,
      );
      expect(JSON.parse(await read('dist/release.json'))).toMatchObject({
        version: due ? '1.0.1' : '1.0.0',
      });
    },
  );

  it('releases the first release with `code` without a commit', async () => {
    await write(build);

    await packRelease(options({ githubOutput: join(dir, 'github-output'), releaseOn: 'code' }));

    expect(await read('github-output')).toContain('changed=true\n');
  });

  it('warns about a breaking change and makes no release', async () => {
    await write({ ...build, 'commits.txt': 'feat!: rename a field (#3)\n' });

    await packRelease(
      options({
        published: ['v1.0.1'],
        commits: join(dir, 'commits.txt'),
        summary: join(dir, 'summary.md'),
        githubOutput: join(dir, 'github-output'),
      }),
    );

    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^::warning::A breaking change can't be released as 1\.x\.y/);
    await expect(readdir(join(dir, 'out'))).rejects.toThrow('ENOENT');
    await expect(readFile(join(dir, 'summary.md'), 'utf8')).rejects.toThrow('ENOENT');
    expect(JSON.parse(await read('dist/release.json'))).toMatchObject({ version: '1.0.1' });
    expect(await read('github-output')).toMatch(/^changed=false\nversion=\nbreaking=true\nerror=/);
  });

  it('warns about a breaking change without writing outputs', async () => {
    await write({ ...build, 'commits.txt': 'fix!: a\n' });

    await packRelease(options({ published: ['v1.0.1'], commits: join(dir, 'commits.txt') }));

    expect(output[0]).toMatch(/^::warning::/);
  });

  it('rejects an unknown release-on value', async () => {
    await expect(packRelease(options({ releaseOn: 'never' }))).rejects.toThrow(
      'Unknown --release-on value: never',
    );
  });
});
