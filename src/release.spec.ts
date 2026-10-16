import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createArchive,
  githubOutput,
  hasChanges,
  isReleaseDue,
  nextVersion,
  selectFiles,
} from './release.ts';

/**
 * A slim tool file, as written by the build.
 * @param updatedAt - the time of the build
 * @param versions - the versions
 */
function toolFile(updatedAt: string, versions: string[]): string {
  return `${JSON.stringify({
    $schema: 'https://containerbase.github.io/tool-versions/v1/tool.schema.json',
    tool: 'helm',
    source: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
    updatedAt,
    versions: versions.map((version) => ({ version })),
  })}\n`;
}

/**
 * The index of the format, with the digest of the slim file.
 * @param updatedAt - the time of the build
 * @param integrity - the digest of the slim file
 */
function indexFile(updatedAt: string, integrity: string): string {
  return `${JSON.stringify({
    updatedAt,
    tools: [
      {
        tool: 'helm',
        versionCount: 1,
        slim: { file: 'helm.json', integrity },
        versionFiles: { file: 'helm.integrity.json', integrity: 'sha256-same' },
      },
    ],
  })}\n`;
}

describe('release', () => {
  describe('nextVersion', () => {
    it('starts the base with patch 0', () => {
      expect(nextVersion('1.0', [])).toBe('1.0.0');
    });

    it('counts up the latest patch version of the base', () => {
      expect(nextVersion('1.0', ['1.0.0', '1.0.10', '1.0.9'])).toBe('1.0.11');
    });

    it('starts again at patch 0 after a bump of the minor or major version', () => {
      expect(nextVersion('1.1', ['1.0.0', '1.0.4'])).toBe('1.1.0');
      expect(nextVersion('2.0', ['1.3.7'])).toBe('2.0.0');
    });

    it('continues a bumped base', () => {
      expect(nextVersion('1.1', ['1.0.4', '1.1.0', '1.1.1'])).toBe('1.1.2');
    });

    it('reads tags with a leading v', () => {
      expect(nextVersion('1.0', ['v1.0.0', 'v1.0.1', 'latest'])).toBe('1.0.2');
    });

    it('ignores versions of other bases, prereleases and look-alikes', () => {
      expect(nextVersion('1.1', ['1.10.5', '1.1.2-beta.1', '11.1.3', '1.1.x', '1.1.1'])).toBe(
        '1.1.2',
      );
    });
  });

  describe('hasChanges', () => {
    const previous = new Map([
      ['index.json', '{"formats":[]}\n'],
      ['v1/helm.json', toolFile('2026-10-15T03:00:00.000Z', ['3.19.0'])],
      ['v1/index.json', indexFile('2026-10-15T03:00:00.000Z', 'sha256-old')],
    ]);

    it('ignores the updatedAt and the digests which follow from it', () => {
      const next = new Map([
        ['index.json', '{"formats":[]}\n'],
        ['v1/helm.json', toolFile('2026-10-16T03:00:00.000Z', ['3.19.0'])],
        ['v1/index.json', indexFile('2026-10-16T03:00:00.000Z', 'sha256-new')],
      ]);

      expect(hasChanges(previous, next)).toBe(false);
    });

    it('finds a changed version list', () => {
      const next = new Map(previous).set(
        'v1/helm.json',
        toolFile('2026-10-16T03:00:00.000Z', ['3.20.0', '3.19.0']),
      );

      expect(hasChanges(previous, next)).toBe(true);
    });

    it('finds a changed integrity file, the digests in the index follow from it', () => {
      const before = new Map(previous).set('v1/helm.integrity.json', '{"versions":{"1":"a"}}\n');
      const after = new Map(previous).set('v1/helm.integrity.json', '{"versions":{"1":"b"}}\n');

      expect(hasChanges(before, after)).toBe(true);
    });

    it('finds an added or a removed file', () => {
      expect(hasChanges(previous, new Map(previous).set('v1/new.json', '{}'))).toBe(true);
      const removed = new Map(previous);
      removed.delete('v1/helm.json');
      expect(hasChanges(previous, removed)).toBe(true);
    });

    it('finds a changed $schema or file which is no json', () => {
      const schema = new Map(previous).set(
        'v1/helm.json',
        toolFile('2026-10-15T03:00:00.000Z', ['3.19.0']).replace('/v1/', '/v2/'),
      );
      expect(hasChanges(previous, schema)).toBe(true);
      expect(hasChanges(new Map([['a.txt', 'a']]), new Map([['a.txt', 'b']]))).toBe(true);
      expect(hasChanges(new Map([['a.json', '{']]), new Map([['a.json', '{']]))).toBe(false);
    });
  });

  describe('isReleaseDue', () => {
    const files = new Map([['v1/helm.json', toolFile('2026-10-15T03:00:00.000Z', ['3.19.0'])]]);

    it('is due without a previous release', () => {
      expect(isReleaseDue(undefined, files)).toBe(true);
    });

    it('is due for a data change only', () => {
      const same = new Map([['v1/helm.json', toolFile('2026-10-16T03:00:00.000Z', ['3.19.0'])]]);
      const changed = new Map([['v1/helm.json', toolFile('2026-10-16T03:00:00.000Z', ['3.20.0'])]]);

      expect(isReleaseDue(files, same)).toBe(false);
      expect(isReleaseDue(files, changed)).toBe(true);
    });
  });

  describe('githubOutput', () => {
    it('has the outputs of the step', () => {
      expect(githubOutput('1.0.3', true)).toBe('changed=true\nversion=1.0.3\n');
      expect(githubOutput('1.0.0', false)).toBe('changed=false\nversion=1.0.0\n');
    });
  });

  describe('selectFiles', () => {
    it('keeps the client files and leaves out the full files and others', () => {
      const files = new Map(
        [
          'index.json',
          'formats.schema.json',
          'v1/index.json',
          'v1/tool.schema.json',
          'v1/helm.json',
          'v1/helm.full.json',
          'v1/helm.integrity.json',
          'v1/helm/3.19.0.json',
          'summary.md',
        ].map((path): [string, string] => [path, '{}']),
      );

      expect([...selectFiles(files).keys()]).toEqual([
        'index.json',
        'formats.schema.json',
        'v1/index.json',
        'v1/tool.schema.json',
        'v1/helm.json',
        'v1/helm.integrity.json',
        'v1/helm/3.19.0.json',
      ]);
    });
  });

  describe('createArchive', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'tool-versions-release-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('writes the archive of the client files with the site root as its root, and its sha512', async () => {
      const dist = join(dir, 'dist');
      await mkdir(join(dist, 'v1', 'helm'), { recursive: true });
      for (const path of [
        'index.json',
        'v1/helm.json',
        'v1/helm.full.json',
        'v1/helm/3.19.0.json',
      ]) {
        await writeFile(join(dist, path), '{"a":1}\n');
      }

      const out = join(dir, 'out');
      const info = await createArchive(dist, out, '1.0.3');

      expect(info).toMatchObject({
        archive: join(out, 'tool-versions-1.0.3.tar.xz'),
        files: 3,
        unpacked: 3 * '{"a":1}\n'.length,
      });
      const { stdout } = await promisify(execFile)('tar', ['-tJf', info.archive]);
      expect(stdout.split('\n').filter(Boolean)).toEqual([
        'index.json',
        'v1/helm.json',
        'v1/helm/3.19.0.json',
      ]);
      // the bare digest of the archive, 128 characters without a newline like
      // the ones of the prebuilds, and no leftovers
      const bytes = await readFile(info.archive);
      const digest = await readFile(`${info.archive}.sha512`, 'utf8');
      expect(digest).toBe(createHash('sha512').update(bytes).digest('hex'));
      expect(digest).toMatch(/^[0-9a-f]{128}$/);
      expect(info.packed).toBe(bytes.byteLength);
      expect((await readdir(out)).sort()).toEqual([
        'tool-versions-1.0.3.tar.xz',
        'tool-versions-1.0.3.tar.xz.sha512',
      ]);
    });
  });
});
