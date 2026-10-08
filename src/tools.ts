import type { Source } from './schema.ts';

/**
 * The tools to publish and the upstream source of their versions, the same one
 * the containerbase cli resolves and installs them from.
 */
export const toolSources: Record<string, Source> = {
  helm: { datasource: 'github-releases', packageName: 'helm/helm' },
  java: { datasource: 'java-version', packageName: 'java-jdk' },
  node: { datasource: 'node-version', packageName: 'node' },
  pnpm: { datasource: 'npm', packageName: 'pnpm' },
  poetry: { datasource: 'pypi', packageName: 'poetry' },
  python: {
    datasource: 'github-releases',
    packageName: 'containerbase/python-prebuild',
  },
};
