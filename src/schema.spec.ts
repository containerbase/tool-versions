import { describe, expect, it } from 'vitest';
import { ToolFile, ToolVersion } from './schema.ts';

const file = {
  name: 'python-3.14.8-jammy-x86_64.tar.xz',
  url: 'https://github.com/containerbase/python-prebuild/releases/download/3.14.8/python-3.14.8-jammy-x86_64.tar.xz',
  checksum: `sha512:${'a'.repeat(128)}`,
  arch: 'amd64',
  distro: 'jammy',
};

describe('schema', () => {
  describe('ToolFile', () => {
    it('accepts sha256 and sha512 checksums', () => {
      expect(ToolFile.parse(file)).toEqual(file);
      const sha256 = { name: 'a.tgz', url: file.url, checksum: `sha256:${'b'.repeat(64)}` };
      expect(ToolFile.parse(sha256)).toEqual(sha256);
    });

    it.each([
      ['ab12'],
      ['sha256:ab12'],
      ['sha1:' + 'a'.repeat(40)],
      [`sha512:${'a'.repeat(64)}`],
      [`sha256:${'A'.repeat(64)}`],
      [`sha256:${'x'.repeat(64)}`],
    ])('rejects the checksum %s', (checksum) => {
      expect(ToolFile.safeParse({ ...file, checksum }).success).toBe(false);
    });

    it('rejects a non-https url, an unknown arch and a missing name', () => {
      expect(ToolFile.safeParse({ ...file, url: 'http://example.com/a' }).success).toBe(false);
      expect(ToolFile.safeParse({ ...file, arch: 'x86_64' }).success).toBe(false);
      expect(ToolFile.safeParse({ ...file, name: '' }).success).toBe(false);
    });
  });

  describe('ToolVersion', () => {
    it('accepts files', () => {
      const version = { version: '3.14.8', files: [file] };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it('accepts a version without files', () => {
      expect(ToolVersion.parse({ version: '3.14.8' })).toEqual({ version: '3.14.8' });
    });

    it('rejects an empty file list', () => {
      expect(ToolVersion.safeParse({ version: '3.14.8', files: [] }).success).toBe(false);
    });
  });
});
