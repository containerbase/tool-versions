import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { releaseNotes } from './release-notes.ts';
import { createArchive, nextVersion, readFiles, releaseBase, selectFiles } from './release.ts';

const { values } = parseArgs({
  options: {
    // the build output
    from: { type: 'string', default: 'dist' },
    // the folder for the archive, its .sha512 and the release notes
    to: { type: 'string', default: 'dist-release' },
    // the versions or tags of the releases, the next version follows the latest of them
    published: { type: 'string', multiple: true, default: [] },
    // the folder with the extracted archive of the previous release
    previous: { type: 'string' },
    // a file with the subjects of the commits since the previous release, one per line
    commits: { type: 'string' },
    // a file to append the size of the archive to, like the job summary
    summary: { type: 'string' },
  },
});

const version = nextVersion(releaseBase, values.published);
await rm(values.to, { recursive: true, force: true });
const info = await createArchive(values.from, values.to, version);

const commits = values.commits
  ? (await readFile(values.commits, 'utf8')).split('\n').filter(Boolean)
  : [];
const notes = releaseNotes({
  version,
  date: new Date(),
  previous: values.previous ? await readFiles(values.previous) : new Map(),
  next: selectFiles(await readFiles(values.from)),
  commits,
});
await writeFile(join(values.to, 'release-notes.md'), notes);

const line = `${info.files} files, ${info.packed} bytes packed, ${info.unpacked} bytes unpacked`;
process.stdout.write(`${info.archive}: ${line}, version ${version}\n`);
if (values.summary) {
  await appendFile(values.summary, `### Release archive ${version}\n\n${line}\n`);
}
