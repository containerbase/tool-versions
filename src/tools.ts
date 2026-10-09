import type { FileTemplate } from './files.ts';
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
