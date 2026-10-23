import { type ToolMetadata, tools } from '@containerbase/base';
import { describe, expect, it } from 'vitest';
import { type AssetTemplate, mayCompute } from './files.ts';
import { toolFiles, toolLinks, toolSources } from './tools.ts';
import { versionings } from './versioning.ts';
import { isPlainSemver } from './versions.ts';

const metadata: Record<string, ToolMetadata> = tools;

describe('tools', () => {
  describe('toolSources', () => {
    it('maps every tool installed by a package manager, except deprecated ones', () => {
      const typed = Object.entries(metadata)
        .filter(([, { type, deprecated }]) => type && !deprecated)
        .map(([tool]) => tool);

      expect(typed.sort()).toEqual(
        Object.keys(toolSources)
          .filter((tool) => metadata[tool]?.type)
          .sort(),
      );
    });

    it('has minCb ranges with a version of the tool and a semver containerbase version', () => {
      const invalid = Object.entries(toolSources).flatMap(([tool, { versioning, minCb = [] }]) =>
        minCb
          .filter(({ from, cb }) => !versionings[versioning].isValid(from) || !isPlainSemver(cb))
          .map(({ from, cb }) => `${tool}: ${from} ${cb}`),
      );

      expect(invalid).toEqual([]);
    });

    it('maps the containerbase prebuild tools with their versioning', () => {
      const prebuilds = Object.fromEntries(
        Object.entries(toolSources)
          .filter(([, { packageName }]) => packageName.startsWith('containerbase/'))
          .map(([tool, { datasource, packageName, versioning }]) => [
            tool,
            [datasource, packageName, versioning],
          ]),
      );

      const prebuild = (tool: string, versioning = 'semver'): string[] => [
        'github-releases',
        `containerbase/${tool}-prebuild`,
        versioning,
      ];
      expect(prebuilds).toEqual({
        composer: prebuild('composer'),
        erlang: prebuild('erlang', 'docker'),
        flutter: prebuild('flutter'),
        git: prebuild('git'),
        golang: prebuild('golang'),
        jb: prebuild('jb', 'loose'),
        maven: prebuild('maven', 'maven'),
        mono: prebuild('mono'),
        nix: prebuild('nix'),
        php: prebuild('php'),
        python: prebuild('python', 'python'),
        ruby: prebuild('ruby', 'ruby'),
        skopeo: prebuild('skopeo'),
        wally: prebuild('wally'),
      });
    });

    it('has no installer type for the prebuild tools, so they have files', () => {
      const typed = Object.entries(toolSources)
        .filter(([, { packageName }]) => packageName.startsWith('containerbase/'))
        .filter(([tool]) => metadata[tool]?.type)
        .map(([tool]) => tool);

      expect(typed).toEqual([]);
    });

    it.each([
      ['npm', 'npm'],
      ['pypi', 'pip'],
      ['rubygems', 'gem'],
      ['nuget', 'dotnet'],
    ])('maps the %s datasource to tools of type %s', (datasource, type) => {
      const types = Object.entries(toolSources)
        .filter(([, source]) => source.datasource === datasource)
        .map(([tool]) => metadata[tool]?.type);

      expect(new Set(types)).toEqual(new Set([type]));
    });

    it('uses the tool name as package name of package manager tools, with exceptions', () => {
      const names = Object.entries(toolSources)
        .filter(([tool]) => metadata[tool]?.type)
        .map(([tool, source]) => [tool, source.packageName]);

      expect(Object.fromEntries(names.filter(([tool, name]) => tool !== name))).toEqual({
        // 1.x is the `yarn` package, the later versions `@yarnpkg/cli-dist`
        yarn: '@yarnpkg/cli-dist',
        'yarn-slim': 'yarn',
        paket: 'Paket',
      });
    });

    it('maps the remaining package manager tools', () => {
      expect({
        cocoapods: toolSources['cocoapods'],
        conan: toolSources['conan'],
        renovate: toolSources['renovate'],
        paket: toolSources['paket'],
      }).toEqual({
        cocoapods: { datasource: 'rubygems', packageName: 'cocoapods', versioning: 'ruby' },
        conan: { datasource: 'pypi', packageName: 'conan', versioning: 'pep440' },
        renovate: { datasource: 'npm', packageName: 'renovate', versioning: 'npm' },
        paket: { datasource: 'nuget', packageName: 'Paket', versioning: 'nuget' },
      });
    });
  });

  describe('toolLinks', () => {
    it('maps every tool to https links', () => {
      expect(Object.keys(toolLinks).sort()).toEqual(Object.keys(toolSources).sort());
      for (const { sourceUrl, homepage } of Object.values(toolLinks)) {
        expect(sourceUrl ?? 'https://x').toMatch(/^https:\/\//);
        expect(homepage ?? 'https://x').toMatch(/^https:\/\//);
      }
      expect(toolLinks['java']).toEqual({ homepage: 'https://adoptium.net' });
    });
  });

  describe('toolFiles', () => {
    /**
     * The asset template of a tool.
     * @param tool - the tool name
     */
    function assetTemplate(tool: string): AssetTemplate {
      const template = toolFiles[tool];
      if (typeof template !== 'object') {
        throw new Error(`${tool} has no asset template`);
      }
      return template;
    }

    it.each([
      ['apko', '1.1.0', ['apko_1.1.0_linux_amd64.tar.gz', 'apko_1.1.0_linux_arm64.tar.gz']],
      ['apm', '0.1.0', ['apm-linux-x86_64.tar.gz', 'apm-linux-arm64.tar.gz']],
      ['buf', '1.50.0', ['buf-Linux-x86_64.tar.gz', 'buf-Linux-aarch64.tar.gz']],
      ['buildx', '0.20.0', ['buildx-v0.20.0.linux-amd64', 'buildx-v0.20.0.linux-arm64']],
      [
        'bun',
        '1.2.0',
        ['bun-linux-x64.zip', 'bun-linux-x64-baseline.zip', 'bun-linux-aarch64.zip'],
      ],
      [
        'gleam',
        '1.8.0',
        [
          'gleam-v1.8.0-x86_64-unknown-linux-musl.tar.gz',
          'gleam-v1.8.0-aarch64-unknown-linux-musl.tar.gz',
        ],
      ],
      [
        'git-lfs',
        '3.7.0',
        ['git-lfs-linux-amd64-v3.7.0.tar.gz', 'git-lfs-linux-arm64-v3.7.0.tar.gz'],
      ],
      [
        'mise',
        '2025.1.0',
        ['mise-v2025.1.0-linux-x64.tar.xz', 'mise-v2025.1.0-linux-arm64.tar.xz'],
      ],
      ['sbt', '1.10.0', ['sbt-1.10.0.tgz']],
      ['sops', '3.9.0', ['sops-v3.9.0.linux.amd64', 'sops-v3.9.0.linux.arm64']],
    ])('lists the %s assets of %s', (tool, version, names) => {
      expect(
        assetTemplate(tool)
          .files(version)
          .map(({ name }) => name),
      ).toEqual(names);
    });

    it('lists the architectures of the assets, bun has two amd64 builds', () => {
      expect(
        assetTemplate('bun')
          .files('1.2.0')
          .map(({ arch }) => arch),
      ).toEqual(['amd64', 'amd64', 'arm64']);
      expect(assetTemplate('sbt').files('1.10.0')).toEqual([{ name: 'sbt-1.10.0.tgz' }]);
    });

    it('maps the checksum assets and tag prefixes', () => {
      expect(assetTemplate('gh').checksum).toMatchObject({ list: expect.any(Function) });
      expect(assetTemplate('deno').checksum).toEqual({ sidecar: ['.sha256sum'] });
      expect(assetTemplate('gleam')).toMatchObject({ algorithm: 'sha512' });
      expect(assetTemplate('bun').tagPrefix).toBe('bun-v');
      expect(assetTemplate('kustomize').tagPrefix).toBe('kustomize/v');
      expect(assetTemplate('gh').tagPrefix).toBeUndefined();
      const lists = Object.entries(toolFiles).flatMap(([tool, template]) =>
        typeof template === 'object' && 'list' in template.checksum
          ? [[tool, template.checksum.list('2.0.0')]]
          : [],
      );
      expect(Object.fromEntries(lists)).toMatchObject({
        gh: 'gh_2.0.0_checksums.txt',
        flux: 'flux_2.0.0_checksums.txt',
        helmfile: 'helmfile_2.0.0_checksums.txt',
        sops: 'sops-v2.0.0.checksums.txt',
        tofu: 'tofu_2.0.0_SHA256SUMS',
        powershell: 'hashes.sha256',
        'git-lfs': 'sha256sums.asc',
        vp: 'vp-checksums.txt',
      });
    });

    it.each([
      ['1.20.0', 'elixir-otp-27.zip'],
      ['1.20.0-rc.1', 'elixir-otp-27.zip'],
      ['1.19.5', 'elixir-otp-26.zip'],
      ['1.18.4', 'elixir-otp-25.zip'],
      ['1.17.0', 'elixir-otp-25.zip'],
      ['1.16.3', 'elixir-otp-24.zip'],
      ['1.15.0', 'elixir-otp-24.zip'],
      ['1.14.5', 'elixir-otp-23.zip'],
      ['1.13.4', 'Precompiled.zip'],
      ['1.0.0', 'Precompiled.zip'],
    ])('has the elixir file of %s as %s', (version, name) => {
      expect(assetTemplate('elixir').files(version)).toEqual([{ name }]);
    });

    it('maps the github release tools to their repository with semver', () => {
      expect(toolSources['gh']).toEqual({
        datasource: 'github-releases',
        packageName: 'cli/cli',
        versioning: 'semver',
      });
      expect(toolSources['kustomize']?.packageName).toBe('kubernetes-sigs/kustomize');
      expect(toolSources['vendir']?.packageName).toBe('vmware-tanzu/carvel-vendir');
      expect(toolSources['powershell']?.packageName).toBe('PowerShell/PowerShell');
    });

    it('maps kubectl, terraform and gradle to their sources', () => {
      expect({
        kubectl: toolSources['kubectl'],
        terraform: toolSources['terraform'],
        gradle: toolSources['gradle'],
      }).toEqual({
        kubectl: {
          datasource: 'github-releases',
          packageName: 'kubernetes/kubernetes',
          versioning: 'semver',
        },
        terraform: {
          datasource: 'hashicorp-releases',
          packageName: 'terraform',
          versioning: 'semver',
        },
        gradle: { datasource: 'gradle-version', packageName: 'gradle', versioning: 'gradle' },
      });
    });

    it('maps the second batch of tools to their sources', () => {
      expect(
        Object.fromEntries(
          ['rust', 'dart', 'ghc', 'cabal', 'java', 'java-jdk', 'java-jre'].map((tool) => [
            tool,
            toolSources[tool],
          ]),
        ),
      ).toEqual({
        rust: {
          datasource: 'rust-version',
          packageName: 'rust-lang/rust',
          versioning: 'rust-release-channel',
        },
        dart: { datasource: 'dart-version', packageName: 'dart', versioning: 'semver' },
        ghc: { datasource: 'haskell-downloads', packageName: 'ghc', versioning: 'docker' },
        cabal: { datasource: 'haskell-downloads', packageName: 'cabal', versioning: 'docker' },
        java: { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
        'java-jdk': { datasource: 'java-version', packageName: 'java-jdk', versioning: 'npm' },
        'java-jre': { datasource: 'java-version', packageName: 'java-jre', versioning: 'npm' },
      });
    });

    it('computes the checksums of the tools which publish none, and of old releases', () => {
      const computed = Object.entries(toolFiles).flatMap(([tool, template]) =>
        typeof template === 'object' && 'compute' in template.checksum ? [tool] : [],
      );
      const old = Object.entries(toolFiles).flatMap(([tool, template]) =>
        typeof template === 'object' && template.computeMissing ? [tool] : [],
      );

      expect(computed.sort()).toEqual(['bazelisk', 'protoc', 'scala']);
      expect(old.sort()).toEqual([
        'buildx',
        'docker-compose',
        'elixir',
        'powershell',
        'sbt',
        'vendir',
      ]);
    });

    it('lists the bazelisk and protoc assets with the arch names of the CLI', () => {
      const names = (tool: string, version: string): string[] => {
        const template = toolFiles[tool];
        return typeof template === 'object' ? template.files(version).map(({ name }) => name) : [];
      };

      expect(names('bazelisk', '1.29.0')).toEqual(['bazelisk-linux-amd64', 'bazelisk-linux-arm64']);
      expect(names('protoc', '25.1')).toEqual([
        'protoc-25.1-linux-x86_64.zip',
        'protoc-25.1-linux-aarch_64.zip',
      ]);
      expect(toolSources['protoc']).toEqual({
        datasource: 'github-releases',
        packageName: 'protocolbuffers/protobuf',
        versioning: 'docker',
      });
    });

    it('maps docker, nuget and scala to their sources', () => {
      expect(
        ['docker', 'nuget', 'scala'].map((tool) => [tool, toolSources[tool]?.datasource]),
      ).toEqual([
        ['docker', 'github-releases'],
        ['nuget', 'nuget-exe'],
        ['scala', 'github-releases'],
      ]);
      expect(toolSources['docker']?.packageName).toBe('moby/moby');
      expect(toolSources['nuget']).toMatchObject({ packageName: 'nuget.exe', versioning: 'nuget' });
      expect(toolSources['scala']?.packageName).toBe('scala/scala');
    });

    it('maps dotnet to the sdk release metadata, which has the checksums', () => {
      expect(toolSources['dotnet']).toEqual({
        datasource: 'dotnet-version',
        packageName: 'dotnet-sdk',
        versioning: 'semver',
      });
      expect(toolFiles['dotnet']).toBeUndefined();
    });

    it('lists the static docker builds of both architectures, computing their checksums', () => {
      const docker = toolFiles['docker'];
      const files = typeof docker === 'function' ? docker('28.5.2') : [];

      expect(mayCompute(docker)).toBe(true);
      expect(files).toEqual([
        {
          name: 'docker-28.5.2-x86_64.tgz',
          url: 'https://download.docker.com/linux/static/stable/x86_64/docker-28.5.2.tgz',
          checksumUrls: [],
          algorithm: 'sha256',
          compute: true,
          arch: 'amd64',
        },
        {
          name: 'docker-28.5.2-aarch64.tgz',
          url: 'https://download.docker.com/linux/static/stable/aarch64/docker-28.5.2.tgz',
          checksumUrls: [],
          algorithm: 'sha256',
          compute: true,
          arch: 'arm64',
        },
      ]);
      const scala = toolFiles['scala'];
      expect(typeof scala === 'object' ? scala.files('2.13.16') : []).toEqual([
        { name: 'scala-2.13.16.tgz' },
      ]);
    });

    it('maps android-sdk-cmdline-tools to the android sdk repository', () => {
      expect(toolSources['android-sdk-cmdline-tools']).toEqual({
        datasource: 'android-sdk',
        packageName: 'cmdline-tools',
        versioning: 'docker',
      });
      expect(toolLinks['android-sdk-cmdline-tools']).toEqual({
        homepage: 'https://developer.android.com/tools',
      });
    });

    it('lists the rust archives, gz before 1.19.0', () => {
      const rust = toolFiles['rust'];
      const files = (version: string): unknown[] | undefined =>
        typeof rust === 'function'
          ? rust(version).map(({ name, arch }) => [name, arch])
          : undefined;

      expect(files('1.80.0')).toEqual([
        ['rust-1.80.0-x86_64-unknown-linux-gnu.tar.xz', 'amd64'],
        ['rust-1.80.0-aarch64-unknown-linux-gnu.tar.xz', 'arm64'],
      ]);
      expect(files('1.18.0')).toEqual([
        ['rust-1.18.0-x86_64-unknown-linux-gnu.tar.gz', 'amd64'],
        ['rust-1.18.0-aarch64-unknown-linux-gnu.tar.gz', 'arm64'],
      ]);
      expect(typeof rust === 'function' ? rust('1.80.0')[0]?.checksumUrls : undefined).toEqual([
        'https://static.rust-lang.org/dist/rust-1.80.0-x86_64-unknown-linux-gnu.tar.xz.sha256',
      ]);
    });

    it('lists the rust nightly archives in the folder of the date', () => {
      const rust = toolFiles['rust'];
      const files = typeof rust === 'function' ? rust('nightly-2026-10-20') : [];

      expect(files).toEqual([
        {
          name: 'rust-nightly-x86_64-unknown-linux-gnu.tar.xz',
          url: 'https://static.rust-lang.org/dist/2026-10-20/rust-nightly-x86_64-unknown-linux-gnu.tar.xz',
          checksumUrls: [
            'https://static.rust-lang.org/dist/2026-10-20/rust-nightly-x86_64-unknown-linux-gnu.tar.xz.sha256',
          ],
          algorithm: 'sha256',
          arch: 'amd64',
        },
        {
          name: 'rust-nightly-aarch64-unknown-linux-gnu.tar.xz',
          url: 'https://static.rust-lang.org/dist/2026-10-20/rust-nightly-aarch64-unknown-linux-gnu.tar.xz',
          checksumUrls: [
            'https://static.rust-lang.org/dist/2026-10-20/rust-nightly-aarch64-unknown-linux-gnu.tar.xz.sha256',
          ],
          algorithm: 'sha256',
          arch: 'arm64',
        },
      ]);
    });

    it('lists the dart sdk zips', () => {
      const dart = toolFiles['dart'];
      expect(typeof dart === 'function' ? dart('3.5.0') : undefined).toEqual([
        {
          name: 'dartsdk-linux-x64-release.zip',
          url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-x64-release.zip',
          checksumUrls: [
            'https://storage.googleapis.com/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-x64-release.zip.sha256sum',
          ],
          algorithm: 'sha256',
          arch: 'amd64',
        },
        {
          name: 'dartsdk-linux-arm64-release.zip',
          url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-arm64-release.zip',
          checksumUrls: [
            'https://storage.googleapis.com/dart-archive/channels/stable/release/3.5.0/sdk/dartsdk-linux-arm64-release.zip.sha256sum',
          ],
          algorithm: 'sha256',
          arch: 'arm64',
        },
      ]);
    });

    it('lists the kubectl binaries of dl.k8s.io with their sha256 files', () => {
      const kubectl = toolFiles['kubectl'];
      expect(typeof kubectl === 'function' ? kubectl('1.37.1') : undefined).toEqual([
        {
          name: 'kubectl-v1.37.1-amd64',
          url: 'https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl',
          checksumUrls: ['https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl.sha256'],
          algorithm: 'sha256',
          arch: 'amd64',
        },
        {
          name: 'kubectl-v1.37.1-arm64',
          url: 'https://dl.k8s.io/release/v1.37.1/bin/linux/arm64/kubectl',
          checksumUrls: ['https://dl.k8s.io/release/v1.37.1/bin/linux/arm64/kubectl.sha256'],
          algorithm: 'sha256',
          arch: 'arm64',
        },
      ]);
    });

    it('lists the helm archives with the sha256 file next to the download', () => {
      const helm = toolFiles['helm'];
      expect(typeof helm === 'function' ? helm('3.19.0') : undefined).toEqual([
        {
          name: 'helm-v3.19.0-linux-amd64.tar.gz',
          url: 'https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz',
          checksumUrls: [
            'https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz.sha256sum',
            'https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz.sha256',
          ],
          algorithm: 'sha256',
          arch: 'amd64',
        },
        {
          name: 'helm-v3.19.0-linux-arm64.tar.gz',
          url: 'https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz',
          checksumUrls: [
            'https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz.sha256sum',
            'https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz.sha256',
          ],
          algorithm: 'sha256',
          arch: 'arm64',
        },
      ]);
    });
  });
});
