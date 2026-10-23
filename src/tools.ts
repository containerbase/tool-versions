import semver from 'semver';
import {
  type Arch,
  type AssetFile,
  type AssetTemplate,
  type ToolFiles,
  computed,
} from './files.ts';
import type { Source, ToolSource } from './schema.ts';
import { nightlyDate } from './versioning.ts';

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
 * one Renovate uses for the tool. A `minCb` lists the ranges of releases which
 * need a newer containerbase: the releases from `from` on, in the versioning of
 * the tool, need at least the containerbase version `cb`. A `from` names the
 * first release of the new scheme including its prereleases, like `3.0.0-rc.1`
 * and not `3.0.0`, as prereleases sort below the release. It can be configured
 * before upstream releases it: the range is published once a matching release
 * exists, starting at the oldest one.
 */
export const toolSources: Record<string, ToolSource> = {
  'android-sdk-cmdline-tools': {
    datasource: 'android-sdk',
    packageName: 'cmdline-tools',
    versioning: 'docker',
  },
  apko: github('chainguard-dev/apko'),
  apm: github('microsoft/apm'),
  buf: github('bufbuild/buf'),
  buildx: github('docker/buildx'),
  bazelisk: github('bazelbuild/bazelisk'),
  bun: github('oven-sh/bun'),
  bundler: { datasource: 'rubygems', packageName: 'bundler', versioning: 'ruby' },
  cabal: { datasource: 'haskell-downloads', packageName: 'cabal', versioning: 'docker' },
  checkov: { datasource: 'pypi', packageName: 'checkov', versioning: 'pep440' },
  cocoapods: { datasource: 'rubygems', packageName: 'cocoapods', versioning: 'ruby' },
  composer: prebuild('composer'),
  conan: { datasource: 'pypi', packageName: 'conan', versioning: 'pep440' },
  copier: { datasource: 'pypi', packageName: 'copier', versioning: 'pep440' },
  corepack: { datasource: 'npm', packageName: 'corepack', versioning: 'npm' },
  dart: { datasource: 'dart-version', packageName: 'dart', versioning: 'semver' },
  deno: github('denoland/deno'),
  devbox: github('jetify-com/devbox'),
  docker: github('moby/moby'),
  dotnet: { datasource: 'dotnet-version', packageName: 'dotnet-sdk', versioning: 'semver' },
  'docker-compose': github('docker/compose'),
  elixir: github('elixir-lang/elixir'),
  erlang: prebuild('erlang', 'docker'),
  flutter: prebuild('flutter'),
  flux: github('fluxcd/flux2'),
  gh: github('cli/cli'),
  git: prebuild('git'),
  'git-lfs': github('git-lfs/git-lfs'),
  gleam: github('gleam-lang/gleam'),
  ghc: { datasource: 'haskell-downloads', packageName: 'ghc', versioning: 'docker' },
  golang: prebuild('golang'),
  gradle: { datasource: 'gradle-version', packageName: 'gradle', versioning: 'gradle' },
  hashin: { datasource: 'pypi', packageName: 'hashin', versioning: 'pep440' },
  helm: github('helm/helm'),
  jb: prebuild('jb', 'loose'),
  protoc: github('protocolbuffers/protobuf', 'docker'),
  helmfile: github('helmfile/helmfile'),
  java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  'java-jdk': { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
  'java-jre': { datasource: 'java-version', packageName: 'java-jre', versioning: 'npm' },
  kas: { datasource: 'pypi', packageName: 'kas', versioning: 'pep440' },
  kubectl: github('kubernetes/kubernetes'),
  kustomize: github('kubernetes-sigs/kustomize'),
  maven: prebuild('maven', 'maven'),
  mise: github('jdx/mise'),
  mono: prebuild('mono'),
  nix: prebuild('nix'),
  node: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
  npm: { datasource: 'npm', packageName: 'npm', versioning: 'npm' },
  nuget: { datasource: 'nuget-exe', packageName: 'nuget.exe', versioning: 'nuget' },
  nub: github('nubjs/nub'),
  paket: { datasource: 'nuget', packageName: 'Paket', versioning: 'nuget' },
  pdm: { datasource: 'pypi', packageName: 'pdm', versioning: 'pep440' },
  php: prebuild('php'),
  'pip-tools': { datasource: 'pypi', packageName: 'pip-tools', versioning: 'pep440' },
  pipenv: { datasource: 'pypi', packageName: 'pipenv', versioning: 'pep440' },
  pixi: github('prefix-dev/pixi'),
  pnpm: { datasource: 'npm', packageName: 'pnpm', versioning: 'npm' },
  poetry: { datasource: 'pypi', packageName: 'poetry', versioning: 'pep440' },
  powershell: github('PowerShell/PowerShell'),
  python: prebuild('python', 'python'),
  renovate: { datasource: 'npm', packageName: 'renovate', versioning: 'npm' },
  ruby: prebuild('ruby', 'ruby'),
  rust: {
    datasource: 'rust-version',
    packageName: 'rust-lang/rust',
    versioning: 'rust-release-channel',
  },
  sbt: github('sbt/sbt'),
  scala: github('scala/scala'),
  skopeo: prebuild('skopeo'),
  sops: github('getsops/sops'),
  swift: { datasource: 'swift-releases', packageName: 'swift', versioning: 'docker' },
  terraform: { datasource: 'hashicorp-releases', packageName: 'terraform', versioning: 'semver' },
  tofu: github('opentofu/opentofu'),
  uv: { datasource: 'pypi', packageName: 'uv', versioning: 'pep440' },
  vendir: github('vmware-tanzu/carvel-vendir'),
  vp: github('voidzero-dev/vite-plus'),
  wally: prebuild('wally'),
  // 1.x is the `yarn` package, see the unions of the npm datasource
  yarn: { datasource: 'npm', packageName: '@yarnpkg/cli-dist', versioning: 'npm' },
  'yarn-slim': { datasource: 'npm', packageName: 'yarn', versioning: 'npm' },
};

/** The links of a tool, published for Renovate's changelogs and links. */
export interface ToolLinks {
  sourceUrl?: string;
  homepage?: string;
}

/** The source code and homepage of the tools. */
export const toolLinks: Record<string, ToolLinks> = {
  'android-sdk-cmdline-tools': {
    homepage: 'https://developer.android.com/tools',
  },
  apko: { sourceUrl: 'https://github.com/chainguard-dev/apko' },
  apm: { sourceUrl: 'https://github.com/microsoft/apm' },
  buf: { sourceUrl: 'https://github.com/bufbuild/buf', homepage: 'https://buf.build' },
  bazelisk: { sourceUrl: 'https://github.com/bazelbuild/bazelisk' },
  buildx: {
    sourceUrl: 'https://github.com/docker/buildx',
    homepage: 'https://docs.docker.com/build',
  },
  bun: { sourceUrl: 'https://github.com/oven-sh/bun', homepage: 'https://bun.sh' },
  // bundler lives in the rubygems repository
  bundler: { sourceUrl: 'https://github.com/rubygems/rubygems', homepage: 'https://bundler.io' },
  cabal: {
    sourceUrl: 'https://github.com/haskell/cabal',
    homepage: 'https://www.haskell.org/cabal',
  },
  checkov: {
    sourceUrl: 'https://github.com/bridgecrewio/checkov',
    homepage: 'https://www.checkov.io',
  },
  cocoapods: {
    sourceUrl: 'https://github.com/CocoaPods/CocoaPods',
    homepage: 'https://cocoapods.org',
  },
  conan: { sourceUrl: 'https://github.com/conan-io/conan', homepage: 'https://conan.io' },
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
  docker: { sourceUrl: 'https://github.com/moby/moby', homepage: 'https://www.docker.com' },
  dotnet: { sourceUrl: 'https://github.com/dotnet/sdk', homepage: 'https://dotnet.microsoft.com' },
  'docker-compose': {
    sourceUrl: 'https://github.com/docker/compose',
    homepage: 'https://docs.docker.com/compose',
  },
  elixir: {
    sourceUrl: 'https://github.com/elixir-lang/elixir',
    homepage: 'https://elixir-lang.org',
  },
  dart: { sourceUrl: 'https://github.com/dart-lang/sdk', homepage: 'https://dart.dev' },
  erlang: { sourceUrl: 'https://github.com/erlang/otp', homepage: 'https://www.erlang.org' },
  flutter: { sourceUrl: 'https://github.com/flutter/flutter', homepage: 'https://flutter.dev' },
  flux: { sourceUrl: 'https://github.com/fluxcd/flux2', homepage: 'https://fluxcd.io' },
  gh: { sourceUrl: 'https://github.com/cli/cli', homepage: 'https://cli.github.com' },
  git: { sourceUrl: 'https://github.com/git/git', homepage: 'https://git-scm.com' },
  'git-lfs': { sourceUrl: 'https://github.com/git-lfs/git-lfs', homepage: 'https://git-lfs.com' },
  gleam: { sourceUrl: 'https://github.com/gleam-lang/gleam', homepage: 'https://gleam.run' },
  ghc: { sourceUrl: 'https://gitlab.haskell.org/ghc/ghc', homepage: 'https://www.haskell.org/ghc' },
  golang: { sourceUrl: 'https://github.com/golang/go', homepage: 'https://go.dev' },
  gradle: { sourceUrl: 'https://github.com/gradle/gradle', homepage: 'https://gradle.org' },
  hashin: { sourceUrl: 'https://github.com/peterbe/hashin' },
  helm: { sourceUrl: 'https://github.com/helm/helm', homepage: 'https://helm.sh' },
  jb: { sourceUrl: 'https://github.com/jsonnet-bundler/jsonnet-bundler' },
  protoc: {
    sourceUrl: 'https://github.com/protocolbuffers/protobuf',
    homepage: 'https://protobuf.dev',
  },
  helmfile: { sourceUrl: 'https://github.com/helmfile/helmfile' },
  java: { homepage: 'https://adoptium.net' },
  'java-jdk': { homepage: 'https://adoptium.net' },
  'java-jre': { homepage: 'https://adoptium.net' },
  kas: { sourceUrl: 'https://github.com/siemens/kas', homepage: 'https://kas.readthedocs.io' },
  kubectl: {
    sourceUrl: 'https://github.com/kubernetes/kubernetes',
    homepage: 'https://kubernetes.io/docs/reference/kubectl',
  },
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
  nuget: {
    sourceUrl: 'https://github.com/NuGet/NuGet.Client',
    homepage: 'https://learn.microsoft.com/nuget',
  },
  nub: { sourceUrl: 'https://github.com/nubjs/nub' },
  paket: {
    sourceUrl: 'https://github.com/fsprojects/Paket',
    homepage: 'https://fsprojects.github.io/Paket',
  },
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
  renovate: {
    sourceUrl: 'https://github.com/renovatebot/renovate',
    homepage: 'https://docs.renovatebot.com',
  },
  ruby: { sourceUrl: 'https://github.com/ruby/ruby', homepage: 'https://www.ruby-lang.org' },
  rust: { sourceUrl: 'https://github.com/rust-lang/rust', homepage: 'https://www.rust-lang.org' },
  sbt: { sourceUrl: 'https://github.com/sbt/sbt', homepage: 'https://www.scala-sbt.org' },
  scala: { sourceUrl: 'https://github.com/scala/scala', homepage: 'https://www.scala-lang.org' },
  skopeo: { sourceUrl: 'https://github.com/containers/skopeo' },
  sops: { sourceUrl: 'https://github.com/getsops/sops', homepage: 'https://getsops.io' },
  swift: { sourceUrl: 'https://github.com/swiftlang/swift', homepage: 'https://www.swift.org' },
  terraform: {
    sourceUrl: 'https://github.com/hashicorp/terraform',
    homepage: 'https://www.terraform.io',
  },
  tofu: { sourceUrl: 'https://github.com/opentofu/opentofu', homepage: 'https://opentofu.org' },
  uv: { sourceUrl: 'https://github.com/astral-sh/uv', homepage: 'https://docs.astral.sh/uv' },
  vendir: {
    sourceUrl: 'https://github.com/vmware-tanzu/carvel-vendir',
    homepage: 'https://carvel.dev/vendir',
  },
  vp: { sourceUrl: 'https://github.com/voidzero-dev/vite-plus' },
  wally: { sourceUrl: 'https://github.com/UpliftGames/wally', homepage: 'https://wally.run' },
  yarn: { sourceUrl: 'https://github.com/yarnpkg/berry', homepage: 'https://yarnpkg.com' },
  'yarn-slim': { sourceUrl: 'https://github.com/yarnpkg/berry', homepage: 'https://yarnpkg.com' },
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
  bazelisk: {
    files: perArch(goArch, (arch) => `bazelisk-linux-${arch}`),
    // the releases have no checksums
    checksum: { compute: true },
  },
  buildx: {
    files: perArch(goArch, (arch, v) => `buildx-v${v}.linux-${arch}`),
    checksum: { list: () => 'checksums.txt' },
    // releases before 0.7.0 have no checksums
    computeMissing: true,
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
    // releases before 2.5.0 have no checksums
    computeMissing: true,
  },
  elixir: {
    files: elixirAsset,
    checksum: { sidecar: ['.sha256sum'] },
    // releases before 1.14 have no checksums
    computeMissing: true,
  },
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
  scala: {
    files: (v) => [{ name: `scala-${v}.tgz` }],
    // neither GitHub nor lightbend publish checksums
    checksum: { compute: true },
  },
  powershell: {
    files: perArch(jsArch, (arch, v) => `powershell-${v}-linux-${arch}.tar.gz`),
    checksum: { list: () => 'hashes.sha256' },
    // releases before 7.2.0 have no checksums
    computeMissing: true,
  },
  protoc: {
    files: perArch(
      { amd64: 'x86_64', arm64: 'aarch_64' },
      (arch, v) => `protoc-${v}-linux-${arch}.zip`,
    ),
    // the releases have no checksums
    checksum: { compute: true },
  },
  sbt: {
    files: (v) => [{ name: `sbt-${v}.tgz` }],
    checksum: { sidecar: ['.sha256'] },
    // releases before 1.3.5 have no checksums
    computeMissing: true,
  },
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
    // releases before 0.25.0 have no checksums
    computeMissing: true,
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
  dart: (version) =>
    (['amd64', 'arm64'] as const).map((arch) => {
      const name = `dartsdk-linux-${arch === 'amd64' ? 'x64' : 'arm64'}-release.zip`;
      const url = `https://storage.googleapis.com/dart-archive/channels/stable/release/${version}/sdk/${name}`;
      return {
        name,
        url,
        checksumUrls: [`${url}.sha256sum`],
        algorithm: 'sha256',
        arch,
      };
    }),
  rust: (version) => {
    // a nightly is `nightly-YYYY-MM-DD`, its files are in the folder of the date
    const date = nightlyDate(version);
    // `.tar.xz` since 1.19.0, the `.tar.gz` ones before, the published nightlies
    // are all `.tar.xz`
    const ext = date || semver.gte(version, '1.19.0') ? 'xz' : 'gz';
    return (['amd64', 'arm64'] as const).map((arch) => {
      const target = `${arch === 'amd64' ? 'x86_64' : 'aarch64'}-unknown-linux-gnu`;
      const name = `rust-${date ? 'nightly' : version}-${target}.tar.${ext}`;
      const url = `https://static.rust-lang.org/dist/${date ? `${date}/` : ''}${name}`;
      return { name, url, checksumUrls: [`${url}.sha256`], algorithm: 'sha256', arch };
    });
  },
  // the static builds have no checksums, they are computed
  docker: computed((version) =>
    (['amd64', 'arm64'] as const).map((arch) => {
      const dir = arch === 'amd64' ? 'x86_64' : 'aarch64';
      return {
        // the file is `docker-<version>.tgz` in the folder of each architecture
        name: `docker-${version}-${dir}.tgz`,
        url: `https://download.docker.com/linux/static/stable/${dir}/docker-${version}.tgz`,
        checksumUrls: [],
        algorithm: 'sha256',
        compute: true,
        arch,
      };
    }),
  ),
  kubectl: (version) =>
    (['amd64', 'arm64'] as const).map((arch) => {
      // the file name is the one of the containerbase download, the binary is
      // called `kubectl` for both architectures
      const name = `kubectl-v${version}-${arch}`;
      const url = `https://dl.k8s.io/release/v${version}/bin/linux/${arch}/kubectl`;
      return { name, url, checksumUrls: [`${url}.sha256`], algorithm: 'sha256', arch };
    }),
};
