import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { parseReleaseDate, releaseNotes } from './release-notes.ts';
import { readFiles } from './release.ts';

const { values } = parseArgs({
  options: {
    // the folder with the extracted archive of the previous release
    previous: { type: 'string' },
    // the folder with the extracted archive of the release
    next: { type: 'string' },
    // the version of the release
    version: { type: 'string' },
    // the date of the release, `YYYY-MM-DD`
    date: { type: 'string' },
    // a file with the subjects of the commits since the previous release, one per line
    commits: { type: 'string' },
    // the file to write the notes to, else they are printed
    out: { type: 'string' },
  },
});

const { previous, next, version, date } = values;
if (!previous || !next || !version || !date) {
  throw new Error('--previous, --next, --version and --date are required');
}
const notes = releaseNotes({
  version,
  date: parseReleaseDate(date),
  previous: await readFiles(previous),
  next: await readFiles(next),
  commits: values.commits
    ? (await readFile(values.commits, 'utf8')).split('\n').filter(Boolean)
    : [],
});
if (values.out) {
  await writeFile(values.out, notes);
} else {
  process.stdout.write(notes);
}
