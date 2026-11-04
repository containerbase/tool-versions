import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { writeRelease } from './output.ts';
import { releaseNotes } from './release-notes.ts';
import {
  buildTimeOf,
  createArchive,
  githubOutput,
  hasReleaseCommit,
  isReleaseDue,
  latestVersion,
  planVersion,
  readFiles,
  releaseMajor,
  selectFiles,
} from './release.ts';

/** The options of the pack step, the parsed arguments of `pack.ts`. */
export interface PackOptions {
  /** the build output */
  from: string;
  /** the folder for the archive, its .sha512 and the release notes */
  to: string;
  /** the versions or tags of the releases, the next version follows the latest of them and the commits */
  published: readonly string[];
  /** the folder with the extracted archive of the previous release */
  previous?: string | undefined;
  /** a file with the subjects of the commits since the previous release, one per line */
  commits?: string | undefined;
  /** a file to append the size of the archive to, like the job summary */
  summary?: string | undefined;
  /** a file to append the outputs of the workflow step to */
  githubOutput?: string | undefined;
  /**
   * `code` only releases when the commits have a feature, a fix or a breaking
   * change, `any` also releases for a change of the data
   */
  releaseOn: string;
}

/**
 * Packs the build output into the release archive with its notes, when the
 * release is due. The `release.json` of the build output is written with the
 * version of the release, or of the latest one when the build makes none. A
 * breaking change blocks the release, but not the build: it is a warning and
 * the outputs have the error, so the release job fails with the message.
 * @param options - the options of the pack step
 * @throws for an unknown `releaseOn` value
 */
export async function packRelease(options: PackOptions): Promise<void> {
  const { from, to, published, releaseOn } = options;
  if (releaseOn !== 'any' && releaseOn !== 'code') {
    throw new Error(`Unknown --release-on value: ${releaseOn}`);
  }

  const commits = options.commits
    ? (await readFile(options.commits, 'utf8')).split('\n').filter(Boolean)
    : [];
  const { version, error } = planVersion(releaseMajor, published, commits);
  const previous = options.previous ? await readFiles(options.previous) : undefined;
  const next = selectFiles(await readFiles(from));
  // the first release doesn't wait for a commit
  const wanted = releaseOn === 'any' || previous === undefined || hasReleaseCommit(commits);
  const changed = error === undefined && isReleaseDue(previous, next) && wanted;

  // the site describes the deployed data: the version of the new release, or of
  // the latest one when the build makes none
  // (a breaking change only happens with a release of the major version)
  await writeRelease(from, {
    version: changed ? version : (latestVersion(releaseMajor, published) ?? version),
    buildTime: buildTimeOf(next) ?? new Date().toISOString(),
  });

  if (error === undefined) {
    await rm(to, { recursive: true, force: true });
    const info = await createArchive(from, to, version);

    const notes = releaseNotes({
      version,
      date: new Date(),
      previous: previous ?? new Map(),
      next,
      commits,
    });
    await writeFile(join(to, 'release-notes.md'), notes);

    const line = `${info.files} files, ${info.packed} bytes packed, ${info.unpacked} bytes unpacked`;
    process.stdout.write(`${info.archive}: ${line}, version ${version}\n`);
    if (options.summary) {
      await appendFile(options.summary, `### Release archive ${version}\n\n${line}\n`);
    }
    if (options.githubOutput) {
      await appendFile(options.githubOutput, githubOutput({ version, changed }));
    }
  } else {
    process.stdout.write(`::warning::${error}\n`);
    if (options.githubOutput) {
      await appendFile(options.githubOutput, githubOutput({ version, changed: false, error }));
    }
  }
}
