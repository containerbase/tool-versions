import { describe, expect, it } from 'vitest';
import { ToolVersion } from './schema.ts';

describe('schema', () => {
  describe('ToolVersion', () => {
    it('accepts sha512 checksums', () => {
      const version = { version: '3.14.8', checksums: { 'a.tar.xz': 'sha512:ab12' } };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it('accepts a version without checksums', () => {
      expect(ToolVersion.parse({ version: '3.14.8' })).toEqual({ version: '3.14.8' });
    });

    it.each(['ab12', 'sha256:ab12', 'sha512:', 'sha512:AB12', 'sha512:xyz'])(
      'rejects the checksum %s',
      (checksum) => {
        expect(
          ToolVersion.safeParse({ version: '1.0.0', checksums: { file: checksum } }).success,
        ).toBe(false);
      },
    );
  });
});
