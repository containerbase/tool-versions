import { describe, expect, it } from 'vitest';
import {
  checksum,
  isUnsupportedDistro,
  parseChecksumFile,
  parseChecksumList,
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
      ['composer-2.8.12.tar.xz', {}],
      ['maven-4.0.0-rc-4.tar.xz', {}],
      ['erlang-28.5.0.7-jammy-x86_64.tar.xz', { arch: 'amd64', distro: 'jammy' }],
      ['php-8.5.0-rc.1-jammy-aarch64.tar.xz', { arch: 'arm64', distro: 'jammy' }],
      ['golang-1.25.0-x86_64.tar.xz', { arch: 'amd64' }],
      ['readme.txt', {}],
    ])('parses %s', (name, expected) => {
      expect(parsePrebuildName(name)).toEqual(expected);
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

  describe('parseChecksumList', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const c = 'c'.repeat(64);

    it('reads the sha256sum formats', () => {
      const text = [
        `${a}  tool_linux_amd64.tar.gz`,
        `${b.toUpperCase()} *tool_linux_arm64.tar.gz`,
        `${c}  ./tool.tgz`,
        '',
        'not a checksum line',
        `${'d'.repeat(10)}  too-short.tgz`,
      ].join('\r\n');

      expect(Object.fromEntries(parseChecksumList(text, 'sha256'))).toEqual({
        'tool_linux_amd64.tar.gz': `sha256:${a}`,
        'tool_linux_arm64.tar.gz': `sha256:${b}`,
        'tool.tgz': `sha256:${c}`,
      });
    });

    it('ignores the armor of a clearsigned list', () => {
      const text = [
        '-----BEGIN PGP SIGNED MESSAGE-----',
        'Hash: SHA256',
        '',
        `${a}  ./git-lfs-linux-amd64-v3.7.0.tar.gz`,
        '-----BEGIN PGP SIGNATURE-----',
        '',
        'iQIzBAEBCAAdFiEE',
        '=abcd',
        '-----END PGP SIGNATURE-----',
      ].join('\n');

      expect(Object.fromEntries(parseChecksumList(text, 'sha256'))).toEqual({
        'git-lfs-linux-amd64-v3.7.0.tar.gz': `sha256:${a}`,
      });
    });

    it('only accepts digests of the algorithm', () => {
      expect(parseChecksumList(`${a}  file`, 'sha512').size).toBe(0);
    });
  });

  describe('isUnsupportedDistro', () => {
    it.each([
      ['bionic', true],
      ['focal', true],
      ['jammy', false],
      [undefined, false],
    ])('%s is %s', (distro, expected) => {
      expect(isUnsupportedDistro(distro)).toBe(expected);
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
