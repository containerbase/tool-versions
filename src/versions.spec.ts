import { describe, expect, it } from 'vitest';
import { compareSemver, sortVersions, toTimestamp, toolVersion } from './versions.ts';

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

    it('only keeps a known release timestamp', () => {
      expect(toolVersion('1.0.0', { releaseTimestamp: undefined })).toStrictEqual({
        version: '1.0.0',
      });
      expect(toolVersion('1.0.0', { releaseTimestamp: '2025-01-01T00:00:00.000Z' })).toEqual({
        version: '1.0.0',
        releaseTimestamp: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  describe('toTimestamp', () => {
    it.each([
      ['2025-10-28', '2025-10-28T00:00:00.000Z'],
      ['2025-09-11T18:15:42+02:00', '2025-09-11T16:15:42.000Z'],
      ['2024-10-15T09:00:00Z', '2024-10-15T09:00:00.000Z'],
      ['2025-03-02T09:00:00.123456Z', '2025-03-02T09:00:00.123Z'],
    ])('normalizes %s', (value, expected) => {
      expect(toTimestamp(value)).toBe(expected);
    });

    it.each([undefined, null, '', 'yesterday'])('rejects %s', (value) => {
      expect(toTimestamp(value)).toBeUndefined();
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
