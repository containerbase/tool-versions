import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  checksum,
  integrityToChecksum,
  parseChecksumFile,
  parsePrebuildName,
  runAll,
  withFiles,
} from './files.ts';

describe('files', () => {
  describe('parsePrebuildName', () => {
    it.each([
      ['python-3.14.8-jammy-x86_64.tar.xz', { arch: 'amd64', distro: 'jammy' }],
      ['python-3.14.8-noble-aarch64.tar.xz', { arch: 'arm64', distro: 'noble' }],
      ['python-3.14.8-x86_64.tar.xz', { arch: 'amd64' }],
      ['python-3.14.8-aarch64.tar.xz', { arch: 'arm64' }],
      ['python-3.14.8.tar.xz', {}],
      ['readme.txt', {}],
    ])('parses %s', (name, expected) => {
      expect(parsePrebuildName(name)).toEqual(expected);
    });
  });

  describe('integrityToChecksum', () => {
    it('converts a sha512 integrity to hex', () => {
      const hash = createHash('sha512').update('pnpm').digest();
      expect(integrityToChecksum(`sha512-${hash.toString('base64')}`)).toBe(
        `sha512:${hash.toString('hex')}`,
      );
    });

    it('picks the sha512 hash of several', () => {
      const hash = createHash('sha512').update('pnpm').digest();
      expect(integrityToChecksum(`sha1-abc= sha512-${hash.toString('base64')}`)).toBe(
        `sha512:${hash.toString('hex')}`,
      );
    });

    it('rejects other or invalid hashes', () => {
      expect(integrityToChecksum('sha1-abcdef==')).toBeUndefined();
      expect(integrityToChecksum('sha512-AAAA')).toBeUndefined();
    });
  });

  describe('checksum', () => {
    it('lowercases a digest of the right length', () => {
      expect(checksum('AB'.repeat(32), 'sha256')).toBe(`sha256:${'ab'.repeat(32)}`);
    });

    it.each([undefined, '', 'ab', 'zz'.repeat(32)])('rejects %s', (digest) => {
      expect(checksum(digest, 'sha256')).toBeUndefined();
    });
  });

  describe('parseChecksumFile', () => {
    it('takes the first token', () => {
      expect(parseChecksumFile(`${'a'.repeat(64)}  file.tgz\n`, 'sha256')).toBe(
        `sha256:${'a'.repeat(64)}`,
      );
    });

    it('rejects text without a digest', () => {
      expect(parseChecksumFile('', 'sha256')).toBeUndefined();
      expect(parseChecksumFile('<html>', 'sha256')).toBeUndefined();
    });
  });

  describe('withFiles', () => {
    it('sorts the files by name', () => {
      const file = (name: string): { name: string; url: string; checksum: string } => ({
        name,
        url: `https://example.com/${name}`,
        checksum: `sha256:${'a'.repeat(64)}`,
      });
      expect(withFiles({ version: '1.0.0' }, [file('b'), file('a')])).toEqual({
        version: '1.0.0',
        files: [file('a'), file('b')],
      });
    });

    it('adds nothing without files', () => {
      expect(withFiles({ version: '1.0.0' }, [])).toEqual({ version: '1.0.0' });
    });
  });

  describe('runAll', () => {
    it('runs every task with at most 8 at once', async () => {
      let running = 0;
      let peak = 0;
      let done = 0;
      const task = async (): Promise<void> => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        done++;
      };

      await runAll(Array.from({ length: 30 }, () => task));

      expect(done).toBe(30);
      expect(peak).toBe(8);
    });
  });
});
