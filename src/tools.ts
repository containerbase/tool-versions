import semver from 'semver';
import type { Arch, AssetFile, AssetTemplate, ToolFiles } from './files.ts';
import type { Source } from './schema.ts';

/**
 * The source of a tool which containerbase publishes as the assets of the
 * releases of `containerbase/<tool>-prebuild`.
 * @param tool - the tool name
 * @param versioning - the Renovate versioning of the tool
 */
function prebuild(tool: string, versioning: Source['versioning'] = 'semver'): Source {
  return github(`containerbase/${tool}-prebuild`, versioning);
}

/**
 * The source of a tool which is published with the releases of a GitHub
 * repository.
 * @param repository - the repository, like `cli/cli`
 * @param versioning - the Renovate versioning of the tool
 */
function github(repository: string, versioning: Source['versioning'] = 'semver'): Source {
  return { datasource: 'github-releases', packageName: repository, versioning };
}

/**
 * The tools to publish and the upstream source of their versions, the same one
 * the containerbase cli resolves and installs them from. The versioning is the
 * one Renovate uses for the tool.
 */
export const toolSources: Record<string, Source> = {
  apko: github('chainguard-dev/apko'),
  apm: github('microsoft/apm'),
  buf: github('bufbuild/buf'),
  buildx: github('docker/buildx'),
  bun: github('oven-sh/bun'),
  bundler: { datasource: 'rubygems', packageName: 'bundler', versioning: 'ruby' },
  checkov: { datasource: 'pypi', packageName: 'checkov', versioning: 'pep440' },
  composer: prebuild('composer'),
  copier: { datasource: 'pypi', packageName: 'copier', versioning: 'pep440' },
  corepack: { datasource: 'npm', packageName: 'corepack', versioning: 'npm' },
  deno: github('denoland/deno'),
  devbox: github('jetify-com/devbox'),
  'docker-compose': github('docker/compose'),
  elixir: github('elixir-lang/elixir'),
  erlang: prebuild('erlang', 'docker'),
  flutter: prebuild('flutter'),
  flux: github('fluxcd/flux2'),
  gh: github('cli/cli'),
  'git-lfs': github('git-lfs/git-lfs'),
  gleam: github('gleam-lang/gleam'),
  golang: prebuild('golang'),
  hashin: { datasource: 'pypi', packageName: 'hashin', versioning: 'pep440' },
  helm: github('helm/helm'),
  helmfile: github('helmfile/helmfile'),
  java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  kas: { datasource: 'pypi', packageName: 'kas', versioning: 'pep440' },
  kustomize: github('kubernetes-sigs/kustomize'),
  maven: prebuild('maven', 'maven'),
  mise: github('jdx/mise'),
  mono: prebuild('mono'),
  nix: prebuild('nix'),
  node: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
  npm: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
  nub: github('nubjs/nub'),
  pdm: { datasource: 'pypi', packageName: 'pdm', versioning: 'pep440' },
  php: prebuild('php'),
  'pip-tools': { datasource: 'pypi', packageName: 'pip-tools', versioning: 'pep440' },
  pipenv: { datasource: 'pypi', packageName: 'pipenv', versioning: 'pep440' },
  pixi: github('prefix-dev/pixi'),
  pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
  poetry: { datasource: 'pypi', packageName: 'poetry', versioning: 'pep440' },
  powershell: github('PowerShell/PowerShell'),
  python: prebuild('python', 'python'),
  ruby: prebuild('ruby', 'ruby'),
  sbt: github('sbt/sbt'),
  skopeo: prebuild('skopeo'),
  sops: github('getsops/sops'),
  tofu: github('opentofu/opentofu'),
  uv: { datasource: 'pypi', packageName: 'uv', versioning: 'pep440' },
  vendir: github('vmware-tanzu/carvel-vendir'),
  vp: github('voidzero-dev/vite-plus'),
  wally: prebuild('wally'),
};

/** The links of a tool, published for Renovate's changelogs and links. */
export interface ToolLinks {
  sourceUrl?: string;
  homepage?: string;
}

/** The source code and homepage of the tools. */
export const toolLinks: Record<string, ToolLinks> = {
  apko: { sourceUrl: 'https://github.com/chainguard-dev/apko' },
  apm: { sourceUrl: 'https://github.com/microsoft/apm' },
  buf: { sourceUrl: 'https://github.com/bufbuild/buf', homepage: 'https://buf.build' },
  buildx: {
    sourceUrl: 'https://github.com/docker/buildx',
    homepage: 'https://docs.docker.com/build',
  },
  bun: { sourceUrl: 'https://github.com/oven-sh/bun', homepage: 'https://bun.sh' },
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
  deno: { sourceUrl: 'https://github.com/denoland/deno', homepage: 'https://deno.com' },
  devbox: {
    sourceUrl: 'https://github.com/jetify-com/devbox',
    homepage: 'https://www.jetify.com/devbox',
  },
  'docker-compose': {
    sourceUrl: 'https://github.com/docker/compose',
    homepage: 'https://docs.docker.com/compose',
  },
  elixir: {
    sourceUrl: 'https://github.com/elixir-lang/elixir',
    homepage: 'https://elixir-lang.org',
  },
  erlang: { sourceUrl: 'https://github.com/erlang/otp', homepage: 'https://www.erlang.org' },
  flutter: { sourceUrl: 'https://github.com/flutter/flutter', homepage: 'https://flutter.dev' },
  flux: { sourceUrl: 'https://github.com/fluxcd/flux2', homepage: 'https://fluxcd.io' },
  gh: { sourceUrl: 'https://github.com/cli/cli', homepage: 'https://cli.github.com' },
  'git-lfs': { sourceUrl: 'https://github.com/git-lfs/git-lfs', homepage: 'https://git-lfs.com' },
  gleam: { sourceUrl: 'https://github.com/gleam-lang/gleam', homepage: 'https://gleam.run' },
  golang: { sourceUrl: 'https://github.com/golang/go', homepage: 'https://go.dev' },
  hashin: { sourceUrl: 'https://github.com/peterbe/hashin' },
  helm: { sourceUrl: 'https://github.com/helm/helm', homepage: 'https://helm.sh' },
  helmfile: { sourceUrl: 'https://github.com/helmfile/helmfile' },
  java: { homepage: 'https://adoptium.net' },
  kas: { sourceUrl: 'https://github.com/siemens/kas', homepage: 'https://kas.readthedocs.io' },
  kustomize: {
    sourceUrl: 'https://github.com/kubernetes-sigs/kustomize',
    homepage: 'https://kustomize.io',
  },
  maven: { sourceUrl: 'https://github.com/apache/maven', homepage: 'https://maven.apache.org' },
  mise: { sourceUrl: 'https://github.com/jdx/mise', homepage: 'https://mise.jdx.dev' },
  mono: {
    sourceUrl: 'https://gitlab.winehq.org/mono/mono',
    homepage: 'https://www.mono-project.com',
  },
  nix: { sourceUrl: 'https://github.com/NixOS/nix', homepage: 'https://nixos.org' },
  node: { sourceUrl: 'https://github.com/nodejs/node', homepage: 'https://nodejs.org' },
  npm: { sourceUrl: 'https://github.com/npm/cli', homepage: 'https://docs.npmjs.com/cli' },
  nub: { sourceUrl: 'https://github.com/nubjs/nub' },
  pdm: { sourceUrl: 'https://github.com/pdm-project/pdm', homepage: 'https://pdm-project.org' },
  php: { sourceUrl: 'https://github.com/php/php-src', homepage: 'https://www.php.net' },
  'pip-tools': {
    sourceUrl: 'https://github.com/jazzband/pip-tools',
    homepage: 'https://pip-tools.readthedocs.io',
  },
  pipenv: { sourceUrl: 'https://github.com/pypa/pipenv', homepage: 'https://pipenv.pypa.io' },
  pixi: { sourceUrl: 'https://github.com/prefix-dev/pixi', homepage: 'https://pixi.sh' },
  pnpm: { sourceUrl: 'https://github.com/pnpm/pnpm', homepage: 'https://pnpm.io' },
  poetry: {
    sourceUrl: 'https://github.com/python-poetry/poetry',
    homepage: 'https://python-poetry.org',
  },
  powershell: { sourceUrl: 'https://github.com/PowerShell/PowerShell' },
  python: { sourceUrl: 'https://github.com/python/cpython', homepage: 'https://www.python.org' },
  ruby: { sourceUrl: 'https://github.com/ruby/ruby', homepage: 'https://www.ruby-lang.org' },
  sbt: { sourceUrl: 'https://github.com/sbt/sbt', homepage: 'https://www.scala-sbt.org' },
  skopeo: { sourceUrl: 'https://github.com/containers/skopeo' },
  sops: { sourceUrl: 'https://github.com/getsops/sops', homepage: 'https://getsops.io' },
  tofu: { sourceUrl: 'https://github.com/opentofu/opentofu', homepage: 'https://opentofu.org' },
  uv: { sourceUrl: 'https://github.com/astral-sh/uv', homepage: 'https://docs.astral.sh/uv' },
  vendir: {
    sourceUrl: 'https://github.com/vmware-tanzu/carvel-vendir',
    homepage: 'https://carvel.dev/vendir',
  },
  vp: { sourceUrl: 'https://github.com/voidzero-dev/vite-plus' },
  wally: { sourceUrl: 'https://github.com/UpliftGames/wally', homepage: 'https://wally.run' },
};

/** The names of the architectures in the asset names of a tool. */
type ArchNames = Record<Arch, string>;

/** `amd64` and `arm64`, like the Go tools name them. */
const goArch: ArchNames = { amd64: 'amd64', arm64: 'arm64' };
/** `x86_64` and `aarch64`. */
const unameArch: ArchNames = { amd64: 'x86_64', arm64: 'aarch64' };
/** `x64` and `arm64`, like node and bun name them. */
const jsArch: ArchNames = { amd64: 'x64', arm64: 'arm64' };

/**
 * Lists one asset per architecture.
 * @param names - the name of each architecture in the asset name
 * @param name - the asset name for an architecture name and a version
 */
function perArch(
  names: ArchNames,
  name: (arch: string, version: string) => string,
): AssetTemplate['files'] {
  return (version) =>
    (['amd64', 'arm64'] as const).map((arch) => ({ arch, name: name(names[arch], version) }));
}

/**
 * The asset with the elixir release for a version, which is built for an OTP
 * version. Old releases have `Precompiled.zip`.
 * @param version - the elixir version
 */
function elixirAsset(version: string): AssetFile[] {
  const { major = 0, minor = 0 } = semver.parse(version) ?? {};
  const release = major * 1000 + minor;
  // the first release (major * 1000 + minor) built for an OTP version
  const builds: [number, number][] = [
    [1020, 27],
    [1019, 26],
    [1017, 25],
    [1015, 24],
    [1014, 23],
  ];
  const otp = builds.find(([from]) => release >= from)?.[1];
  return [{ name: otp ? `elixir-otp-${otp}.zip` : 'Precompiled.zip' }];
}

/**
 * The files of the tools which aren't a release asset with the checksum in
 * another one: a function lists them, or a template for the assets of the
 * release.
 */
export const toolFiles: Record<string, ToolFiles> = {
  apko: {
    files: perArch(goArch, (arch, v) => `apko_${v}_linux_${arch}.tar.gz`),
    checksum: { list: () => 'checksums.txt' },
  },
  apm: {
    files: perArch({ amd64: 'x86_64', arm64: 'arm64' }, (arch) => `apm-linux-${arch}.tar.gz`),
    checksum: { sidecar: ['.sha256'] },
  },
  buf: {
    files: perArch(unameArch, (arch) => `buf-Linux-${arch}.tar.gz`),
    checksum: { list: () => 'sha256.txt' },
  },
  buildx: {
    files: perArch(goArch, (arch, v) => `buildx-v${v}.linux-${arch}`),
    checksum: { list: () => 'checksums.txt' },
  },
  bun: {
    tagPrefix: 'bun-v',
    // the baseline build is for cpus without AVX2
    files: () => [
      { arch: 'amd64', name: 'bun-linux-x64.zip' },
      { arch: 'amd64', name: 'bun-linux-x64-baseline.zip' },
      { arch: 'arm64', name: 'bun-linux-aarch64.zip' },
    ],
    checksum: { list: () => 'SHASUMS256.txt' },
  },
  deno: {
    files: perArch(unameArch, (arch) => `deno-${arch}-unknown-linux-gnu.zip`),
    checksum: { sidecar: ['.sha256sum'] },
  },
  devbox: {
    files: perArch(goArch, (arch, v) => `devbox_${v}_linux_${arch}.tar.gz`),
    checksum: { list: () => 'checksums.txt' },
  },
  'docker-compose': {
    files: perArch(unameArch, (arch) => `docker-compose-linux-${arch}`),
    checksum: { list: () => 'checksums.txt' },
  },
  elixir: { files: elixirAsset, checksum: { sidecar: ['.sha256sum'] } },
  flux: {
    files: perArch(goArch, (arch, v) => `flux_${v}_linux_${arch}.tar.gz`),
    checksum: { list: (v) => `flux_${v}_checksums.txt` },
  },
  gh: {
    files: perArch(goArch, (arch, v) => `gh_${v}_linux_${arch}.tar.gz`),
    checksum: { list: (v) => `gh_${v}_checksums.txt` },
  },
  'git-lfs': {
    files: perArch(goArch, (arch, v) => `git-lfs-linux-${arch}-v${v}.tar.gz`),
    // a clearsigned list
    checksum: { list: () => 'sha256sums.asc' },
  },
  gleam: {
    files: perArch(unameArch, (arch, v) => `gleam-v${v}-${arch}-unknown-linux-musl.tar.gz`),
    checksum: { sidecar: ['.sha512'] },
    algorithm: 'sha512',
  },
  helmfile: {
    files: perArch(goArch, (arch, v) => `helmfile_${v}_linux_${arch}.tar.gz`),
    checksum: { list: (v) => `helmfile_${v}_checksums.txt` },
  },
  kustomize: {
    // the other tags of the repository belong to other modules
    tagPrefix: 'kustomize/v',
    files: perArch(goArch, (arch, v) => `kustomize_v${v}_linux_${arch}.tar.gz`),
    checksum: { list: () => 'checksums.txt' },
  },
  mise: {
    files: perArch(jsArch, (arch, v) => `mise-v${v}-linux-${arch}.tar.xz`),
    checksum: { list: () => 'SHASUMS256.txt' },
  },
  nub: {
    files: perArch(jsArch, (arch) => `nub-linux-${arch}.tar.gz`),
    checksum: { sidecar: ['.sha256'] },
  },
  pixi: {
    files: perArch(unameArch, (arch) => `pixi-${arch}-unknown-linux-musl.tar.gz`),
    checksum: { sidecar: ['.sha256'] },
  },
  powershell: {
    files: perArch(jsArch, (arch, v) => `powershell-${v}-linux-${arch}.tar.gz`),
    checksum: { list: () => 'hashes.sha256' },
  },
  sbt: { files: (v) => [{ name: `sbt-${v}.tgz` }], checksum: { sidecar: ['.sha256'] } },
  sops: {
    files: perArch(goArch, (arch, v) => `sops-v${v}.linux.${arch}`),
    checksum: { list: (v) => `sops-v${v}.checksums.txt` },
  },
  tofu: {
    files: perArch(goArch, (arch, v) => `tofu_${v}_linux_${arch}.tar.gz`),
    checksum: { list: (v) => `tofu_${v}_SHA256SUMS` },
  },
  vendir: {
    files: perArch(goArch, (arch) => `vendir-linux-${arch}`),
    checksum: { list: () => 'checksums.txt' },
  },
  vp: {
    files: perArch(unameArch, (arch) => `vp-${arch}-unknown-linux-gnu.tar.gz`),
    checksum: { list: () => 'vp-checksums.txt' },
  },
  helm: (version) =>
    (['amd64', 'arm64'] as const).map((arch) => {
      const name = `helm-v${version}-linux-${arch}.tar.gz`;
      const url = `https://get.helm.sh/${name}`;
      // older releases only have a `.sha256` file with the bare digest
      const checksumUrls = [`${url}.sha256sum`, `${url}.sha256`];
      return { name, url, checksumUrls, algorithm: 'sha256', arch };
    }),
};
