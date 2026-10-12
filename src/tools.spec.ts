import { type ToolMetadata, tools } from '@containerbase/base';
import { describe, expect, it } from 'vitest';
import { toolFiles, toolLinks, toolSources } from './tools.ts';

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
    it('lists the helm archives with the sha256 file next to the download', () => {
      expect(toolFiles['helm']?.('3.19.0')).toEqual([
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
