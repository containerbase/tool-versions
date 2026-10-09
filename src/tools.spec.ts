import { describe, expect, it } from 'vitest';
import { toolFiles } from './tools.ts';

describe('tools', () => {
  describe('toolFiles', () => {
    it('lists the helm archives with the sha256 file next to the download', () => {
      expect(toolFiles['helm']?.('3.19.0')).toEqual([
        {
          name: 'helm-v3.19.0-linux-amd64.tar.gz',
          url: 'https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz',
          checksumUrl: 'https://get.helm.sh/helm-v3.19.0-linux-amd64.tar.gz.sha256sum',
          algorithm: 'sha256',
          arch: 'amd64',
        },
        {
          name: 'helm-v3.19.0-linux-arm64.tar.gz',
          url: 'https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz',
          checksumUrl: 'https://get.helm.sh/helm-v3.19.0-linux-arm64.tar.gz.sha256sum',
          algorithm: 'sha256',
          arch: 'arm64',
        },
      ]);
    });
  });
});
