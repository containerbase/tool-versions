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

/** The links of a tool, published for Renovate's changelogs and links. */
export interface ToolLinks {
  sourceUrl?: string;
  homepage?: string;
}

/** The source code and homepage of the tools. */
export const toolLinks: Record<string, ToolLinks> = {
  helm: { sourceUrl: 'https://github.com/helm/helm', homepage: 'https://helm.sh' },
  java: { homepage: 'https://adoptium.net' },
  node: { sourceUrl: 'https://github.com/nodejs/node', homepage: 'https://nodejs.org' },
  pnpm: { sourceUrl: 'https://github.com/pnpm/pnpm', homepage: 'https://pnpm.io' },
  poetry: {
    sourceUrl: 'https://github.com/python-poetry/poetry',
    homepage: 'https://python-poetry.org',
  },
  python: { sourceUrl: 'https://github.com/python/cpython', homepage: 'https://www.python.org' },
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
