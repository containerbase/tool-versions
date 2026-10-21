import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BreakingChangeError,
  createArchive,
  githubOutput,
  hasChanges,
  isReleaseDue,
  nextVersion,
  planVersion,
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
    it('starts the major version with 0.0, without a release', () => {
      expect(nextVersion(1, [], [])).toBe('1.0.0');
      expect(nextVersion(2, ['v1.3.7'], ['feat: a'])).toBe('2.0.0');
    });

    it('is a patch release for a change of the data only', () => {
      expect(nextVersion(1, ['v1.0.0', 'v1.0.1'], [])).toBe('1.0.2');
    });

    it('is a patch release for fixes and other commits', () => {
      expect(
        nextVersion(1, ['v1.0.1'], ['fix: b (#2)', 'docs: c', 'chore: d', 'not conventional']),
      ).toBe('1.0.2');
    });

    it('is a minor release for a feature', () => {
      expect(nextVersion(1, ['v1.0.1'], ['fix: b', 'feat(npm): a (#1)'])).toBe('1.1.0');
    });

    it('counts up the highest version, also after a minor release', () => {
      const published = ['v1.0.1', 'v1.1.0', 'v1.0.9', 'v1.1.3'];

      expect(nextVersion(1, published, [])).toBe('1.1.4');
      expect(nextVersion(1, published, ['feat: a'])).toBe('1.2.0');
    });

    it('rejects a breaking change of the major version of the latest release', () => {
      expect(() => nextVersion(1, ['v1.0.1'], ['feat!: rename a field (#3)'])).toThrow(
        /only changes with a new format folder/,
      );
      expect(() => nextVersion(1, ['v1.0.1'], ['fix(x): a BREAKING CHANGE'])).toThrow(
        BreakingChangeError,
      );
    });

    it('starts a new major version with a breaking change, as it has a new format folder', () => {
      expect(nextVersion(2, ['v1.3.7'], ['feat!: new format (#4)'])).toBe('2.0.0');
      expect(nextVersion(1, [], ['feat!: first (#4)'])).toBe('1.0.0');
    });

    it('reads tags with and without a leading v and ignores others', () => {
      expect(
        nextVersion(
          1,
          ['1.0.0', 'v1.0.1', 'latest', 'v2.5.0', 'v1.2.x', 'v1.0.2-beta.1', 'v11.0.0'],
          [],
        ),
      ).toBe('1.0.2');
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

    it('ignores the key order, also of nested objects, but not the order of arrays', () => {
      const before = new Map([
        ['v1/a.json', '{"tool":"a","source":{"datasource":"npm","packageName":"a"},"versions":[]}'],
        [
          'v1/index.json',
          '{"tools":[{"tool":"a","slim":{"file":"a.json","integrity":"x"},"versionCount":1}]}',
        ],
      ]);
      const reordered = new Map([
        ['v1/a.json', '{"versions":[],"source":{"packageName":"a","datasource":"npm"},"tool":"a"}'],
        [
          'v1/index.json',
          '{"tools":[{"versionCount":1,"slim":{"integrity":"y","file":"a.json"},"tool":"a"}]}',
        ],
      ]);
      const changed = new Map(reordered).set(
        'v1/a.json',
        '{"versions":[],"source":{"packageName":"b","datasource":"npm"},"tool":"a"}',
      );
      const ascending = new Map([['v1/a.json', '{"versions":[{"version":"1"},{"version":"2"}]}']]);
      const descending = new Map([['v1/a.json', '{"versions":[{"version":"2"},{"version":"1"}]}']]);

      expect(hasChanges(before, reordered)).toBe(false);
      expect(hasChanges(before, changed)).toBe(true);
      expect(hasChanges(ascending, descending)).toBe(true);
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

    it('is not due when only the key order changed', () => {
      const reordered = new Map([
        [
          'v1/helm.json',
          '{"versions":[{"version":"3.19.0"}],"updatedAt":"2026-10-16T03:00:00.000Z","source":{"versioning":"semver","packageName":"helm/helm","datasource":"github-releases"},"tool":"helm","$schema":"https://containerbase.github.io/tool-versions/v1/tool.schema.json"}\n',
        ],
      ]);

      expect(isReleaseDue(files, reordered)).toBe(false);
    });
  });

  describe('planVersion', () => {
    it('is the next version', () => {
      expect(planVersion(1, ['v1.0.1'], ['fix: a'])).toEqual({ version: '1.0.2' });
    });

    it('returns a breaking change as an error instead of throwing it', () => {
      const plan = planVersion(1, ['v1.0.1'], ['feat!: rename a field (#3)']);

      expect(plan.version).toBe('');
      expect(plan.error).toContain("A breaking change can't be released as 1.x.y");
      expect(plan.error).toContain('feat: rename a field (#3)');
    });

    it('has the next major version for a breaking change with a new format folder', () => {
      expect(planVersion(2, ['v1.0.1'], ['feat!: new format'])).toEqual({ version: '2.0.0' });
    });
  });

  describe('githubOutput', () => {
    it('has the outputs of the step', () => {
      expect(githubOutput({ version: '1.0.3', changed: true })).toBe(
        'changed=true\nversion=1.0.3\nbreaking=false\nerror=\n',
      );
      expect(githubOutput({ version: '1.0.0', changed: false })).toBe(
        'changed=false\nversion=1.0.0\nbreaking=false\nerror=\n',
      );
    });

    it('flags a breaking change with its message', () => {
      expect(githubOutput({ version: '', changed: false, error: 'a breaking change' })).toBe(
        'changed=false\nversion=\nbreaking=true\nerror=a breaking change\n',
      );
    });
  });

  describe('selectFiles', () => {
    it('keeps the client files and leaves out others', () => {
      const files = new Map(
        [
          'index.json',
          'formats.schema.json',
          'v1/index.json',
          'v1/tool.schema.json',
          'v1/helm.json',
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
      for (const path of ['index.json', 'v1/helm.json', 'v1/helm/3.19.0.json']) {
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
