import { appendFile } from 'node:fs/promises';
import type { LogEntry } from './log.ts';
import type { ToolVersion } from './schema.ts';

/** What happened to a tool in a build. */
export type ToolStatus = 'updated' | 'kept previous' | 'failed';

/** What a build did for one tool. */
export interface ToolReport {
  tool: string;
  status: ToolStatus;
  /** the versions which are published */
  versions: number;
  /** the versions which weren't in the previous file */
  newVersions: number;
  /** the files which weren't in the previous file */
  filesAdded: number;
  /** the files whose checksum was computed by downloading them */
  computedFiles: number;
  /** the bytes which were downloaded for them */
  computedBytes: number;
  /** the files which wait for the next builds, as the share of the tool was used up */
  waitingFiles: number;
  /** the warnings and errors of the tool, without the notices */
  logs: LogEntry[];
}

/** The data of a build, filled while it runs. */
export class BuildReport {
  readonly tools: ToolReport[] = [];
  /** whether it is a full build, without the previous state */
  readonly full: boolean;
  /** the download budget, in bytes */
  readonly budget: number;
  /** when the build started, in milliseconds */
  readonly start: number;

  /**
   * @param full - whether it is a full build, without the previous state
   * @param budget - the download budget, in bytes
   * @param start - when the build started, in milliseconds
   */
  constructor(full: boolean, budget: number, start: number) {
    this.full = full;
    this.budget = budget;
    this.start = start;
  }

  /**
   * Adds what the build did for a tool.
   * @param report - the report of the tool
   */
  add(report: ToolReport): void {
    this.tools.push(report);
  }

  /**
   * Renders the job summary as Markdown.
   * @param end - when the build ended, in milliseconds
   */
  render(end: number): string {
    return renderSummary(this, end);
  }
}

/**
 * Counts the files of the versions which aren't in the previous versions.
 * @param versions - the published versions
 * @param previous - the versions of the previous file
 */
export function countNewFiles(versions: ToolVersion[], previous: ToolVersion[]): number {
  const known = new Set(
    previous.flatMap(({ version, files }) => (files ?? []).map(({ name }) => `${version} ${name}`)),
  );
  return versions
    .flatMap(({ version, files }) => (files ?? []).map(({ name }) => `${version} ${name}`))
    .filter((key) => !known.has(key)).length;
}

/**
 * Formats a number of bytes.
 * @param bytes - the bytes
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Formats a duration.
 * @param milliseconds - the duration
 */
function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

/**
 * Escapes text for a Markdown table cell: pipes and line breaks, and the
 * characters of html.
 * @param text - the text
 */
export function escapeCell(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * Renders the job summary of a build: a headline, the download budget, a table
 * with a row per tool and the warnings and errors of the tools which have any.
 * @param report - the report of the build
 * @param end - when the build ended, in milliseconds
 */
function renderSummary(report: BuildReport, end: number): string {
  const tools = [...report.tools].sort((a, b) => a.tool.localeCompare(b.tool, 'en'));
  const count = (status: ToolStatus): number =>
    tools.filter((tool) => tool.status === status).length;
  const sum = (pick: (tool: ToolReport) => number): number =>
    tools.reduce((total, tool) => total + pick(tool), 0);
  const used = sum((tool) => tool.computedBytes);

  const rows = tools.map((tool) =>
    [
      escapeCell(tool.tool),
      tool.status,
      String(tool.versions),
      String(tool.newVersions),
      String(tool.filesAdded),
      tool.computedFiles ? `${tool.computedFiles} (${formatBytes(tool.computedBytes)})` : '–',
      String(tool.logs.length),
    ].join(' | '),
  );
  const details = tools
    .filter((tool) => tool.logs.length)
    .map((tool) =>
      [
        `<details><summary>${escapeCell(tool.tool)}: ${tool.logs.length} ${tool.logs.length === 1 ? 'message' : 'messages'}</summary>`,
        '',
        ...tool.logs.map(({ level, message }) => `- **${level}** ${escapeCell(message)}`),
        '',
        '</details>',
      ].join('\n'),
    );

  return [
    '## Build summary',
    '',
    `${report.full ? 'Full' : 'Incremental'} build in ${formatDuration(end - report.start)}. Tools updated: ${count('updated')}, kept previous: ${count('kept previous')}, failed: ${count('failed')}. Versions: ${sum((tool) => tool.versions)}.`,
    '',
    '### Download budget',
    '',
    `Budget: ${formatBytes(report.budget)}, used: ${formatBytes(used)}. Computed checksums: ${sum((tool) => tool.computedFiles)}, waiting for the next builds: ${sum((tool) => tool.waitingFiles)}.`,
    '',
    '### Tools',
    '',
    '| Tool | Status | Versions | New | Files added | Computed | Warnings |',
    '| --- | --- | ---: | ---: | ---: | --- | ---: |',
    ...rows.map((row) => `| ${row} |`),
    ...(details.length ? ['', '### Warnings and errors', '', details.join('\n\n')] : []),
    '',
  ].join('\n');
}

/**
 * Appends the job summary to the file GitHub Actions renders on the run page.
 * @param file - the file of `GITHUB_STEP_SUMMARY`
 * @param markdown - the summary
 */
export async function writeSummary(file: string, markdown: string): Promise<void> {
  await appendFile(file, markdown);
}
