import { describe, expect, it } from 'vitest';
import { toolFiles, toolLinks, toolSources } from './tools.ts';

describe('tools', () => {
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
