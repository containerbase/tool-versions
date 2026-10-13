import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolVersion } from './schema.ts';
import { BuildReport, countNewFiles, escapeCell, formatBytes, writeSummary } from './summary.ts';

/**
 * A file of a version.
 * @param name - the file name
 */
function file(name: string): NonNullable<ToolVersion['files']>[number] {
  return { name, url: `https://example.com/${name}`, checksum: `sha256:${'a'.repeat(64)}` };
}

describe('summary', () => {
  it('renders the headline, the budget, the sorted table and the messages of the tools', () => {
    const report = new BuildReport(false, 3 * 1024 ** 3, 1000);
    report.add({
      tool: 'node',
      status: 'kept previous',
      versions: 300,
      newVersions: 0,
      filesAdded: 0,
      computedFiles: 0,
      computedBytes: 0,
      waitingFiles: 0,
      logs: [{ level: 'warning', message: 'node: GET https://nodejs.org failed with status 500' }],
    });
    report.add({
      tool: 'docker',
      status: 'updated',
      versions: 120,
      newVersions: 2,
      filesAdded: 40,
      computedFiles: 38,
      computedBytes: 2.5 * 1024 ** 3,
      waitingFiles: 90,
      logs: [],
    });
    report.add({
      tool: 'bad|tool',
      status: 'failed',
      versions: 0,
      newVersions: 0,
      filesAdded: 0,
      computedFiles: 0,
      computedBytes: 0,
      waitingFiles: 0,
      logs: [{ level: 'error', message: 'bad|tool: No versions\nfound <html>' }],
    });

    expect(report.render(13_400)).toBe(
      [
        '## Build summary',
        '',
        'Incremental build in 12 s. Tools updated: 1, kept previous: 1, failed: 1. Versions: 420.',
        '',
        '### Download budget',
        '',
        'Budget: 3.0 GiB, used: 2.5 GiB. Computed checksums: 38, waiting for the next builds: 90.',
        '',
        '### Tools',
        '',
        '| Tool | Status | Versions | New | Files added | Computed | Warnings |',
        '| --- | --- | ---: | ---: | ---: | --- | ---: |',
        '| bad\\|tool | failed | 0 | 0 | 0 | – | 1 |',
        '| docker | updated | 120 | 2 | 40 | 38 (2.5 GiB) | 0 |',
        '| node | kept previous | 300 | 0 | 0 | – | 1 |',
        '',
        '### Warnings and errors',
        '',
        '<details><summary>bad\\|tool: 1 message</summary>',
        '',
        '- **error** bad\\|tool: No versions found &lt;html&gt;',
        '',
        '</details>',
        '',
        '<details><summary>node: 1 message</summary>',
        '',
        '- **warning** node: GET https://nodejs.org failed with status 500',
        '',
        '</details>',
        '',
      ].join('\n'),
    );
  });

  it('renders a full build without warnings and without a section for them', () => {
    const report = new BuildReport(true, 1024, 0);
    report.add({
      tool: 'helm',
      status: 'updated',
      versions: 5,
      newVersions: 5,
      filesAdded: 10,
      computedFiles: 0,
      computedBytes: 0,
      waitingFiles: 0,
      logs: [],
    });

    const markdown = report.render(125_000);

    expect(markdown).toContain(
      'Full build in 2 min 5 s. Tools updated: 1, kept previous: 0, failed: 0. Versions: 5.',
    );
    expect(markdown).not.toContain('Warnings and errors');
  });

  it('appends to the summary file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'summary-'));
    try {
      await writeSummary(join(dir, 'summary.md'), 'one\n');
      await writeSummary(join(dir, 'summary.md'), 'two\n');

      expect(await readFile(join(dir, 'summary.md'), 'utf8')).toBe('one\ntwo\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KiB'],
    [1.5 * 1024 ** 2, '1.5 MiB'],
    [3 * 1024 ** 3, '3.0 GiB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('escapes pipes, line breaks and html in a table cell', () => {
    expect(escapeCell('a | b\r\n c <i> & d')).toBe('a \\| b c &lt;i&gt; &amp; d');
  });

  it('counts the files which are not in the previous versions', () => {
    const previous: ToolVersion[] = [{ version: '2.0.0', files: [file('a'), file('b')] }];
    const versions: ToolVersion[] = [
      { version: '3.0.0', files: [file('a')] },
      { version: '2.0.0', files: [file('a'), file('b'), file('c')] },
      { version: '1.0.0' },
    ];

    expect(countNewFiles(versions, previous)).toBe(2);
    expect(countNewFiles(versions, [])).toBe(4);
  });
});
