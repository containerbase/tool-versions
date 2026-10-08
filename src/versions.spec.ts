import { describe, expect, it } from 'vitest';
import { compareSemver, sortVersions, toolVersion } from './versions.ts';

describe('versions', () => {
  describe('toolVersion', () => {
    it('only keeps true flags', () => {
      expect(toolVersion('1.0.0')).toEqual({ version: '1.0.0' });
      expect(toolVersion('1.0.0', { prerelease: false, lts: false })).toStrictEqual({
        version: '1.0.0',
      });
      expect(toolVersion('1.0.0-rc.1', { prerelease: true, lts: true })).toEqual({
        version: '1.0.0-rc.1',
        prerelease: true,
        lts: true,
      });
    });
  });

  describe('sortVersions', () => {
    it('sorts newest first and keeps the first duplicate', () => {
      expect(
        sortVersions(
          [
            { version: '1.2.0' },
            { version: '1.10.0', lts: true },
            { version: '1.10.0' },
            { version: '2.0.0-rc.1', prerelease: true },
          ],
          compareSemver,
        ),
      ).toEqual([
        { version: '2.0.0-rc.1', prerelease: true },
        { version: '1.10.0', lts: true },
        { version: '1.2.0' },
      ]);
    });
  });

  describe('compareSemver', () => {
    it('compares build metadata', () => {
      expect(compareSemver('17.0.12+7', '17.0.12+10')).toBe(-1);
      expect(compareSemver('17.0.12+7', '17.0.11+10')).toBe(1);
    });
  });
});
