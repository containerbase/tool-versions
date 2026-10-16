import { describe, expect, it } from 'vitest';
import { codeChanges, dataChanges, releaseNotes } from './release-notes.ts';

/**
 * A slim tool file with some versions.
 * @param versions - the versions
 */
function tool(...versions: string[]): string {
  return JSON.stringify({
    tool: 'x',
    updatedAt: '2026-10-16T03:00:00.000Z',
    versions: versions.map((version) => ({ version })),
  });
}

/**
 * The files of a release with some tools.
 * @param tools - the tool files by tool name
 */
function files(tools: Record<string, string>): Map<string, string> {
  return new Map([
    // files which aren't tool files
    ['v1/index.json', '{"tools":[]}'],
    ['v1/node.integrity.json', '{"versions":{"1":"a"}}'],
    ['v1/tool.schema.json', '{}'],
    ['index.json', '{}'],
    ...Object.entries(tools).map(([name, content]): [string, string] => [
      `v1/${name}.json`,
      content,
    ]),
  ]);
}

describe('release-notes', () => {
  describe('dataChanges', () => {
    it('lists the added and removed versions, the new and the gone tools, by tool name', () => {
      const previous = files({
        python: tool('3.14.8', '2.7.17'),
        node: tool('24.21.0'),
        gone: tool('1.0.0'),
        same: tool('1.0.0'),
      });
      const next = files({
        python: tool('3.14.9', '3.14.8'),
        node: tool('24.22.0', '24.21.0'),
        'android-sdk-cmdline-tools': tool('13'),
        same: tool('1.0.0'),
      });

      expect(dataChanges(previous, next)).toEqual([
        { tool: 'android-sdk-cmdline-tools', status: 'new', added: ['13'], removed: [] },
        { tool: 'gone', status: 'gone', added: [], removed: ['1.0.0'] },
        { tool: 'node', status: 'changed', added: ['24.22.0'], removed: [] },
        { tool: 'python', status: 'changed', added: ['3.14.9'], removed: ['2.7.17'] },
      ]);
    });

    it('ignores the updatedAt and files which are no valid tool files', () => {
      const previous = files({ node: tool('24.21.0'), broken: '{', other: '{"a":1}' });
      const next = files({ node: tool('24.21.0').replace('03:00', '04:00'), broken: '[' });

      expect(dataChanges(previous, next)).toEqual([]);
    });
  });

  describe('codeChanges', () => {
    it('groups the conventional commits like semantic-release', () => {
      expect(
        codeChanges([
          'feat: publish git (#130)',
          'fix(npm): keep the schema (#129)',
          'chore(deps): update dependency zod to v4.6.8 (#128)',
          'perf: read the files once (#127)',
          'docs: split the readme (#126)',
          'Merge branch main',
          'refactor!: rename the files (#125)',
          'ci: pin the action (#124)',
        ]),
      ).toEqual([
        '### BREAKING CHANGES\n\n- rename the files (#125)',
        '### Features\n\n- publish git (#130)',
        '### Bug Fixes\n\n- **npm:** keep the schema (#129)',
        '### Performance Improvements\n\n- read the files once (#127)',
        '### Other\n\n- split the readme (#126)\n- rename the files (#125)',
      ]);
    });

    it('has no section without commits', () => {
      expect(codeChanges(['chore: x', 'test: y'])).toEqual([]);
    });
  });

  describe('releaseNotes', () => {
    it('has the header, the data changes and the code changes', () => {
      const previous = files({ node: tool('24.21.0') });
      const versions = Array.from({ length: 12 }, (_, index) => `26.${index}.0`);
      const next = files({ node: tool(...versions, '24.21.0'), swift: tool('6.4.1', '6.4.0') });

      expect(
        releaseNotes({
          version: '1.0.3',
          date: new Date('2026-10-16T03:00:00.000Z'),
          previous,
          next,
          commits: ['feat: publish swift (#99)'],
        }),
      ).toBe(
        [
          '## 1.0.3 (2026-10-16)',
          '',
          '### Data changes',
          '',
          '- `node`: added 26.0.0, 26.1.0, 26.2.0, 26.3.0, 26.4.0, 26.5.0, 26.6.0, 26.7.0, 26.8.0, 26.9.0 and 2 more',
          '- `swift`: new tool with 2 versions',
          '',
          '### Features',
          '',
          '- publish swift (#99)',
          '',
        ].join('\n'),
      );
    });

    it('has only the header without changes', () => {
      expect(
        releaseNotes({
          version: '1.0.0',
          date: new Date('2026-10-16T03:00:00.000Z'),
          previous: files({}),
          next: files({}),
          commits: [],
        }),
      ).toBe('## 1.0.0 (2026-10-16)\n');
    });
  });
});
