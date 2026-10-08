import process from 'node:process';
import { parseArgs } from 'node:util';
import { build } from './build.ts';

const { values } = parseArgs({
  options: {
    // fetch every version again, without the previously published files
    full: { type: 'boolean', default: false },
  },
});

const failed = await build({ dir: 'dist', full: values.full });
if (failed.length) {
  process.stderr.write(`Failed tools: ${failed.join(', ')}\n`);
  process.exitCode = 1;
}
