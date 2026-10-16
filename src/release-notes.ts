import { z } from 'zod';
import { formatDir } from './formats.ts';
import type { FileMap } from './release.ts';

/** The most versions of a tool the notes list, the rest is counted. */
const maxVersions = 10;

/** The versions of a tool file, the rest of the file is of no interest. */
const ToolFileVersions = z.object({ versions: z.array(z.object({ version: z.string() })) });

/** The files of the format folder which are not the file of a tool. */
const otherFiles = /(^index|\.(integrity|schema|full))\.json$/;

/** The data changes of one tool. */
export interface ToolChange {
  /** the tool name */
  tool: string;
  /** whether the tool is new, gone or only has other versions */
  status: 'new' | 'gone' | 'changed';
  /** the versions which are new */
  added: string[];
  /** the versions which are gone */
  removed: string[];
}

/**
 * Reads the versions of each tool from the `<tool>.json` files of a release.
 * @param files - the files of the release
 * @returns the versions by tool name
 */
function versionsByTool(files: FileMap): Map<string, string[]> {
  const tools = new Map<string, string[]>();
  for (const [path, content] of files) {
    const match = new RegExp(`^${formatDir}/([^/]+)\\.json$`).exec(path);
    const tool = match?.[1];
    if (!tool || otherFiles.test(path.slice(formatDir.length + 1))) {
      continue;
    }
    try {
      const parsed = ToolFileVersions.safeParse(JSON.parse(content));
      if (parsed.success) {
        tools.set(
          tool,
          parsed.data.versions.map(({ version }) => version),
        );
      }
    } catch {
      // a file which is no json has no versions
    }
  }
  return tools;
}

/**
 * Finds the versions which were added and removed per tool, and the tools
 * which are new or gone. Only the version lists are compared, so what changes
 * with every build, like the `updatedAt`, is no change.
 * @param previous - the files of the previous release
 * @param next - the files of the new release
 * @returns the changes, sorted by tool name
 */
export function dataChanges(previous: FileMap, next: FileMap): ToolChange[] {
  const before = versionsByTool(previous);
  const after = versionsByTool(next);
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((tool): ToolChange[] => {
    const old = before.get(tool);
    const current = after.get(tool);
    const added = (current ?? []).filter((version) => !old?.includes(version));
    const removed = (old ?? []).filter((version) => !current?.includes(version));
    const status = old === undefined ? 'new' : current === undefined ? 'gone' : 'changed';
    return status === 'changed' && !added.length && !removed.length
      ? []
      : [{ tool, status, added, removed }];
  });
}

/**
 * Lists versions, at most `maxVersions` of them.
 * @param versions - the versions
 */
function listVersions(versions: string[]): string {
  const rest = versions.length - maxVersions;
  return rest > 0
    ? `${versions.slice(0, maxVersions).join(', ')} and ${rest} more`
    : versions.join(', ');
}

/**
 * Formats the data changes of a tool as a line of the notes.
 * @param change - the changes of the tool
 */
function formatChange({ tool, status, added, removed }: ToolChange): string {
  if (status === 'new') {
    return `- \`${tool}\`: new tool with ${added.length} version${added.length === 1 ? '' : 's'}`;
  }
  if (status === 'gone') {
    return `- \`${tool}\`: tool removed`;
  }
  const parts = [
    ...(added.length ? [`added ${listVersions(added)}`] : []),
    ...(removed.length ? [`removed ${listVersions(removed)}`] : []),
  ];
  return `- \`${tool}\`: ${parts.join('; ')}`;
}

/** A commit with a conventional subject, like `feat(scope): add it (#123)`. */
interface Commit {
  type: string;
  scope?: string;
  breaking: boolean;
  /** the description, with the pull request number as in the subject */
  description: string;
}

/**
 * Parses a conventional commit subject.
 * @param subject - the subject
 * @returns the commit, or `undefined` for a subject which isn't conventional
 */
function parseCommit(subject: string): Commit | undefined {
  const match = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/.exec(
    subject.trim(),
  );
  const { type, scope, breaking, description } = match?.groups ?? {};
  return type && description
    ? { type, ...(scope && { scope }), breaking: Boolean(breaking), description }
    : undefined;
}

/** The headings of the commit types which are in the notes, like semantic-release's. */
const commitGroups: [heading: string, types: string[]][] = [
  ['Features', ['feat']],
  ['Bug Fixes', ['fix']],
  ['Performance Improvements', ['perf']],
  ['Reverts', ['revert']],
  ['Other', ['refactor', 'docs']],
];

/**
 * Formats a commit as a line of the notes.
 * @param commit - the commit
 */
function formatCommit({ scope, description }: Commit): string {
  return `- ${scope ? `**${scope}:** ` : ''}${description}`;
}

/**
 * Groups the conventional commits by their type like the default preset of
 * semantic-release: features, bug fixes, performance improvements, reverts,
 * and breaking changes of any type. Commits of other types, like `chore`,
 * `ci`, `test` and `build`, and subjects which aren't conventional are left
 * out.
 * @param subjects - the commit subjects, newest first
 * @returns the markdown sections
 */
export function codeChanges(subjects: readonly string[]): string[] {
  const commits = subjects.flatMap((subject) => parseCommit(subject) ?? []);
  const breaking = commits.filter((commit) => commit.breaking);
  return [
    ...(breaking.length
      ? [`### BREAKING CHANGES\n\n${breaking.map(formatCommit).join('\n')}`]
      : []),
    ...commitGroups.flatMap(([heading, types]) => {
      const group = commits.filter((commit) => types.includes(commit.type));
      return group.length ? [`### ${heading}\n\n${group.map(formatCommit).join('\n')}`] : [];
    }),
  ];
}

/** The input of the release notes. */
export interface ReleaseNotesInput {
  /** the version of the release */
  version: string;
  /** the date of the release */
  date: Date;
  /** the files of the previous release, none for the first release */
  previous: FileMap;
  /** the files of the new release */
  next: FileMap;
  /** the subjects of the commits since the previous release, newest first */
  commits: readonly string[];
}

/**
 * Creates the markdown notes of a release: a header with the version and the
 * date, the versions added and removed per tool, and the code changes.
 * @param input - the version, the release contents and the commits
 * @returns the notes
 */
export function releaseNotes({
  version,
  date,
  previous,
  next,
  commits,
}: ReleaseNotesInput): string {
  const data = dataChanges(previous, next);
  const sections = [
    `## ${version} (${date.toISOString().slice(0, 10)})`,
    ...(data.length ? [`### Data changes\n\n${data.map(formatChange).join('\n')}`] : []),
    ...codeChanges(commits),
  ];
  return `${sections.join('\n\n')}\n`;
}
