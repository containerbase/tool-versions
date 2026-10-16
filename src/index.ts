import process from 'node:process';
import { parseArgs } from 'node:util';
import { build } from './build.ts';

const { values } = parseArgs({
  options: {
    // fetch every version again, without the previous state
    full: { type: 'boolean', default: false },
    // the folder with the extracted archive of the latest release, to start from
    'previous-archive': { type: 'string' },
  },
});

const failed = await build({
  dir: 'dist',
  full: values.full,
  previousArchive: values['previous-archive'],
});
if (failed.length) {
  process.stderr.write(`Failed tools: ${failed.join(', ')}\n`);
  process.exitCode = 1;
}
