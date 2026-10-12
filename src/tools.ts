import type { FileTemplate } from './files.ts';
import type { Source } from './schema.ts';

/**
 * The tools to publish and the upstream source of their versions, the same one
 * the containerbase cli resolves and installs them from. The versioning is the
 * one Renovate uses for the tool.
 */
export const toolSources: Record<string, Source> = {
  bundler: { datasource: 'rubygems', packageName: 'bundler', versioning: 'ruby' },
  checkov: { datasource: 'pypi', packageName: 'checkov', versioning: 'pep440' },
  copier: { datasource: 'pypi', packageName: 'copier', versioning: 'pep440' },
  corepack: { datasource: 'npm', packageName: 'corepack', versioning: 'npm' },
  hashin: { datasource: 'pypi', packageName: 'hashin', versioning: 'pep440' },
  helm: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
  java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  kas: { datasource: 'pypi', packageName: 'kas', versioning: 'pep440' },
  node: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
  npm: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
  pdm: { datasource: 'pypi', packageName: 'pdm', versioning: 'pep440' },
  'pip-tools': { datasource: 'pypi', packageName: 'pip-tools', versioning: 'pep440' },
  pipenv: { datasource: 'pypi', packageName: 'pipenv', versioning: 'pep440' },
  pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
  poetry: { datasource: 'pypi', packageName: 'poetry', versioning: 'pep440' },
  uv: { datasource: 'pypi', packageName: 'uv', versioning: 'pep440' },
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
  // bundler lives in the rubygems repository
  bundler: { sourceUrl: 'https://github.com/rubygems/rubygems', homepage: 'https://bundler.io' },
  checkov: {
    sourceUrl: 'https://github.com/bridgecrewio/checkov',
    homepage: 'https://www.checkov.io',
  },
  copier: {
    sourceUrl: 'https://github.com/copier-org/copier',
    homepage: 'https://copier.readthedocs.io',
  },
  corepack: {
    sourceUrl: 'https://github.com/nodejs/corepack',
    homepage: 'https://github.com/nodejs/corepack',
  },
  hashin: { sourceUrl: 'https://github.com/peterbe/hashin' },
  helm: { sourceUrl: 'https://github.com/helm/helm', homepage: 'https://helm.sh' },
  java: { homepage: 'https://adoptium.net' },
  kas: { sourceUrl: 'https://github.com/siemens/kas', homepage: 'https://kas.readthedocs.io' },
  node: { sourceUrl: 'https://github.com/nodejs/node', homepage: 'https://nodejs.org' },
  npm: { sourceUrl: 'https://github.com/npm/cli', homepage: 'https://docs.npmjs.com/cli' },
  pdm: { sourceUrl: 'https://github.com/pdm-project/pdm', homepage: 'https://pdm-project.org' },
  'pip-tools': {
    sourceUrl: 'https://github.com/jazzband/pip-tools',
    homepage: 'https://pip-tools.readthedocs.io',
  },
  pipenv: { sourceUrl: 'https://github.com/pypa/pipenv', homepage: 'https://pipenv.pypa.io' },
  pnpm: { sourceUrl: 'https://github.com/pnpm/pnpm', homepage: 'https://pnpm.io' },
  poetry: {
    sourceUrl: 'https://github.com/python-poetry/poetry',
    homepage: 'https://python-poetry.org',
  },
  python: { sourceUrl: 'https://github.com/python/cpython', homepage: 'https://www.python.org' },
  uv: { sourceUrl: 'https://github.com/astral-sh/uv', homepage: 'https://docs.astral.sh/uv' },
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
