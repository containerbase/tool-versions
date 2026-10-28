import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
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

const { values } = parseArgs({
  options: {
    // the build output
    from: { type: 'string', default: 'dist' },
    // the folder for the archive, its .sha512 and the release notes
    to: { type: 'string', default: 'dist-release' },
    // the versions or tags of the releases, the next version follows the latest of them
    // and the commits
    published: { type: 'string', multiple: true, default: [] },
    // the folder with the extracted archive of the previous release
    previous: { type: 'string' },
    // a file with the subjects of the commits since the previous release, one per line
    commits: { type: 'string' },
    // a file to append the size of the archive to, like the job summary
    summary: { type: 'string' },
    // a file to append the outputs of the workflow step to: `changed`, whether a
    // release is due, and the `version`
    'github-output': { type: 'string' },
    // `code` only releases when the commits have a feature, a fix or a breaking
    // change, `any` (the default) also releases for a change of the data
    'release-on': { type: 'string', default: 'any' },
  },
});

if (values['release-on'] !== 'any' && values['release-on'] !== 'code') {
  throw new Error(`Unknown --release-on value: ${values['release-on']}`);
}

const commits = values.commits
  ? (await readFile(values.commits, 'utf8')).split('\n').filter(Boolean)
  : [];
const { version, error } = planVersion(releaseMajor, values.published, commits);
const previous = values.previous ? await readFiles(values.previous) : undefined;
const next = selectFiles(await readFiles(values.from));
// the first release doesn't wait for a commit
const wanted =
  values['release-on'] === 'any' || previous === undefined || hasReleaseCommit(commits);
const changed = error === undefined && isReleaseDue(previous, next) && wanted;

// the site describes the deployed data: the version of the new release, or of
// the latest one when the build makes none
const released = changed ? version : (latestVersion(releaseMajor, values.published) ?? version);
if (released) {
  await writeRelease(values.from, {
    version: released,
    buildTime: buildTimeOf(next) ?? new Date().toISOString(),
  });
}

if (error === undefined) {
  await rm(values.to, { recursive: true, force: true });
  const info = await createArchive(values.from, values.to, version);

  const notes = releaseNotes({
    version,
    date: new Date(),
    previous: previous ?? new Map(),
    next,
    commits,
  });
  await writeFile(join(values.to, 'release-notes.md'), notes);

  const line = `${info.files} files, ${info.packed} bytes packed, ${info.unpacked} bytes unpacked`;
  process.stdout.write(`${info.archive}: ${line}, version ${version}\n`);
  if (values.summary) {
    await appendFile(values.summary, `### Release archive ${version}\n\n${line}\n`);
  }
  if (values['github-output']) {
    await appendFile(values['github-output'], githubOutput({ version, changed }));
  }
} else {
  // a breaking change blocks the release, but not the build: the release job
  // fails with the message
  process.stdout.write(`::warning::${error}\n`);
  if (values['github-output']) {
    await appendFile(values['github-output'], githubOutput({ version, changed: false, error }));
  }
}
