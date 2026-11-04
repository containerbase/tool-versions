import { parseArgs } from 'node:util';

import { packRelease } from './pack-release.ts';

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

await packRelease({
  from: values.from,
  to: values.to,
  published: values.published,
  previous: values.previous,
  commits: values.commits,
  summary: values.summary,
  githubOutput: values['github-output'],
  releaseOn: values['release-on'],
});
