import type { FileTemplate } from './files.ts';
import type { Source } from './schema.ts';

/**
 * The source of a tool which containerbase publishes as the assets of the
 * releases of `containerbase/<tool>-prebuild`.
 * @param tool - the tool name
 * @param versioning - the Renovate versioning of the tool
 */
function prebuild(tool: string, versioning: Source['versioning'] = 'semver'): Source {
  return {
    datasource: 'github-releases',
    packageName: `containerbase/${tool}-prebuild`,
    versioning,
  };
}

/**
 * The tools to publish and the upstream source of their versions, the same one
 * the containerbase cli resolves and installs them from. The versioning is the
 * one Renovate uses for the tool.
 */
export const toolSources: Record<string, Source> = {
  bundler: { datasource: 'rubygems', packageName: 'bundler', versioning: 'ruby' },
  checkov: { datasource: 'pypi', packageName: 'checkov', versioning: 'pep440' },
  composer: prebuild('composer'),
  copier: { datasource: 'pypi', packageName: 'copier', versioning: 'pep440' },
  corepack: { datasource: 'npm', packageName: 'corepack', versioning: 'npm' },
  erlang: prebuild('erlang', 'docker'),
  flutter: prebuild('flutter'),
  golang: prebuild('golang'),
  hashin: { datasource: 'pypi', packageName: 'hashin', versioning: 'pep440' },
  helm: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
  java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  kas: { datasource: 'pypi', packageName: 'kas', versioning: 'pep440' },
  maven: prebuild('maven', 'maven'),
  mono: prebuild('mono'),
  nix: prebuild('nix'),
  node: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
  npm: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
  pdm: { datasource: 'pypi', packageName: 'pdm', versioning: 'pep440' },
  php: prebuild('php'),
  'pip-tools': { datasource: 'pypi', packageName: 'pip-tools', versioning: 'pep440' },
  pipenv: { datasource: 'pypi', packageName: 'pipenv', versioning: 'pep440' },
  pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
  poetry: { datasource: 'pypi', packageName: 'poetry', versioning: 'pep440' },
  python: prebuild('python', 'python'),
  ruby: prebuild('ruby', 'ruby'),
  skopeo: prebuild('skopeo'),
  uv: { datasource: 'pypi', packageName: 'uv', versioning: 'pep440' },
  wally: prebuild('wally'),
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
  composer: {
    sourceUrl: 'https://github.com/composer/composer',
    homepage: 'https://getcomposer.org',
  },
  copier: {
    sourceUrl: 'https://github.com/copier-org/copier',
    homepage: 'https://copier.readthedocs.io',
  },
  corepack: {
    sourceUrl: 'https://github.com/nodejs/corepack',
    homepage: 'https://github.com/nodejs/corepack',
  },
  erlang: { sourceUrl: 'https://github.com/erlang/otp', homepage: 'https://www.erlang.org' },
  flutter: { sourceUrl: 'https://github.com/flutter/flutter', homepage: 'https://flutter.dev' },
  golang: { sourceUrl: 'https://github.com/golang/go', homepage: 'https://go.dev' },
  hashin: { sourceUrl: 'https://github.com/peterbe/hashin' },
  helm: { sourceUrl: 'https://github.com/helm/helm', homepage: 'https://helm.sh' },
  java: { homepage: 'https://adoptium.net' },
  kas: { sourceUrl: 'https://github.com/siemens/kas', homepage: 'https://kas.readthedocs.io' },
  maven: { sourceUrl: 'https://github.com/apache/maven', homepage: 'https://maven.apache.org' },
  mono: { sourceUrl: 'https://github.com/mono/mono', homepage: 'https://www.mono-project.com' },
  nix: { sourceUrl: 'https://github.com/NixOS/nix', homepage: 'https://nixos.org' },
  node: { sourceUrl: 'https://github.com/nodejs/node', homepage: 'https://nodejs.org' },
  npm: { sourceUrl: 'https://github.com/npm/cli', homepage: 'https://docs.npmjs.com/cli' },
  pdm: { sourceUrl: 'https://github.com/pdm-project/pdm', homepage: 'https://pdm-project.org' },
  php: { sourceUrl: 'https://github.com/php/php-src', homepage: 'https://www.php.net' },
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
  ruby: { sourceUrl: 'https://github.com/ruby/ruby', homepage: 'https://www.ruby-lang.org' },
  skopeo: { sourceUrl: 'https://github.com/containers/skopeo' },
  uv: { sourceUrl: 'https://github.com/astral-sh/uv', homepage: 'https://docs.astral.sh/uv' },
  wally: { sourceUrl: 'https://github.com/UpliftGames/wally', homepage: 'https://wally.run' },
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
