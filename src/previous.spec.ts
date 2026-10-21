import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readArchivePrevious } from './previous.ts';
import type { ToolFile } from './schema.ts';

const file = (name: string): ToolFile => ({
  name,
  url: `https://example.com/${name}`,
  checksum: `sha256:${'a'.repeat(64)}`,
  arch: 'amd64',
});
const source = { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' };

describe('previous', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  /**
   * Writes an extracted archive with the slim file of helm and the files of two of
   * its three versions.
   */
  async function extractedArchive(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'tool-versions-previous-'));
    await mkdir(join(dir, 'v1', 'helm'), { recursive: true });
    const slim = {
      $schema: 'https://containerbase.github.io/tool-versions/v1/tool.schema.json',
      tool: 'helm',
      source,
      updatedAt: '2026-10-07T03:00:00.000Z',
      versions: [
        { version: '4.0.0', releaseTimestamp: '2026-10-01T00:00:00.000Z', archs: ['amd64'] },
        { version: '4.0.0-rc.1', prerelease: true },
        { version: '3.0.0+1', archs: ['amd64'], distros: ['noble'] },
      ],
    };
    await writeFile(join(dir, 'v1', 'helm.json'), JSON.stringify(slim));
    for (const version of ['4.0.0', '3.0.0+1']) {
      const files = [file(`helm-${version}.tgz`)];
      await writeFile(
        join(dir, 'v1', 'helm', `${version}.json`),
        JSON.stringify({ tool: 'helm', version, files }),
      );
    }
    return dir;
  }

  // the archs and distros are left out, the output derives them from the files
  it('rebuilds the previous data from the slim file and the files of the versions', async () => {
    const archive = await extractedArchive();

    await expect(readArchivePrevious(archive, 'helm')).resolves.toEqual({
      $schema: 'https://containerbase.github.io/tool-versions/v1/tool.schema.json',
      tool: 'helm',
      source,
      updatedAt: '2026-10-07T03:00:00.000Z',
      versions: [
        {
          version: '4.0.0',
          releaseTimestamp: '2026-10-01T00:00:00.000Z',
          files: [file('helm-4.0.0.tgz')],
        },
        // a version without files stays without
        { version: '4.0.0-rc.1', prerelease: true },
        { version: '3.0.0+1', files: [file('helm-3.0.0+1.tgz')] },
      ],
    });
  });

  it('accepts a slim file published without versioning', async () => {
    const archive = await extractedArchive();
    await writeFile(
      join(archive, 'v1', 'old.json'),
      JSON.stringify({
        tool: 'old',
        source: { datasource: 'github-releases', packageName: 'a/old' },
        updatedAt: '2026-10-07T03:00:00.000Z',
        versions: [{ version: '1.0.0' }],
      }),
    );

    expect((await readArchivePrevious(archive, 'old'))?.versions).toEqual([{ version: '1.0.0' }]);
  });

  it('has nothing for a tool which is not in the archive', async () => {
    const archive = await extractedArchive();

    await expect(readArchivePrevious(archive, 'new-tool')).resolves.toBeUndefined();
  });

  it('has nothing for an invalid slim file and ignores an invalid file of a version', async () => {
    const archive = await extractedArchive();
    await writeFile(join(archive, 'v1', 'helm', '4.0.0.json'), '{');
    await writeFile(join(archive, 'v1', 'broken.json'), '{"tool":1}');

    expect(
      (await readArchivePrevious(archive, 'helm'))?.versions.map(({ files }) => files?.length),
    ).toEqual([undefined, undefined, 1]);
    await expect(readArchivePrevious(archive, 'broken')).resolves.toBeUndefined();
  });
});
