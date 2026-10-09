import type { FileTemplate } from './files.ts';
import type { Source } from './schema.ts';

/**
 * The tools to publish and the upstream source of their versions, the same one
 * the containerbase cli resolves and installs them from. The versioning is the
 * one Renovate uses for the tool.
 */
export const toolSources: Record<string, Source> = {
  helm: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
  java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  node: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
  pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
  poetry: { datasource: 'pypi', packageName: 'poetry', versioning: 'pep440' },
  python: {
    datasource: 'github-releases',
    packageName: 'containerbase/python-prebuild',
    versioning: 'python',
  },
};

/**
 * The files of the tools which don't publish them as release assets, with the
 * checksum next to the download.
 */
export const toolFiles: Record<string, FileTemplate> = {
  helm: (version) =>
    (['amd64', 'arm64'] as const).map((arch) => {
      const name = `helm-v${version}-linux-${arch}.tar.gz`;
      const url = `https://get.helm.sh/${name}`;
      // older releases only have a `.sha256` file with the bare digest
      const checksumUrls = [`${url}.sha256sum`, `${url}.sha256`];
      return { name, url, checksumUrls, algorithm: 'sha256', arch };
    }),
};
