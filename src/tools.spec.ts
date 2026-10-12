import { type ToolMetadata, tools } from '@containerbase/base';
import { describe, expect, it } from 'vitest';
import type { AssetTemplate } from './files.ts';
import { toolFiles, toolLinks, toolSources } from './tools.ts';

const metadata: Record<string, ToolMetadata> = tools;

describe('tools', () => {
  describe('toolSources', () => {
    it('maps every tool installed by a package manager, except deprecated ones', () => {
      // typed in @containerbase/base 14.32.0, mapped in the next change
      const unmapped = ['cocoapods', 'conan', 'paket', 'renovate', 'yarn', 'yarn-slim'];
      const typed = Object.entries(metadata)
        .filter(([tool, { type, deprecated }]) => type && !deprecated && !unmapped.includes(tool))
        .map(([tool]) => tool);

      expect(typed.sort()).toEqual(
        Object.keys(toolSources)
          .filter((tool) => metadata[tool]?.type)
          .sort(),
      );
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
        golang: prebuild('golang'),
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
    ])('maps the %s datasource to tools of type %s', (datasource, type) => {
      const types = Object.entries(toolSources)
        .filter(([, source]) => source.datasource === datasource)
        .map(([tool]) => metadata[tool]?.type);

      expect(new Set(types)).toEqual(new Set([type]));
    });

    it('uses the tool name as package name of package manager tools', () => {
      const names = Object.entries(toolSources)
        .filter(([tool]) => metadata[tool]?.type)
        .map(([tool, source]) => [tool, source.packageName]);

      expect(names.filter(([tool, name]) => tool !== name)).toEqual([]);
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
