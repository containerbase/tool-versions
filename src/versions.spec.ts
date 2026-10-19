import { describe, expect, it } from 'vitest';
import {
  compareRuby,
  compareSemver,
  isRubyVersion,
  sortVersions,
  toConstraints,
  toTimestamp,
  toolVersion,
} from './versions.ts';

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

    it('only keeps known constraints', () => {
      expect(toolVersion('1.0.0', { constraints: undefined })).toStrictEqual({ version: '1.0.0' });
      expect(toolVersion('1.0.0', { constraints: { node: '>=20' } })).toEqual({
        version: '1.0.0',
        constraints: { node: '>=20' },
      });
    });
  });

  describe('toConstraints', () => {
    it('keys the trimmed constraint by the parent', () => {
      expect(toConstraints('node', ' >=20 ')).toEqual({ node: '>=20' });
    });

    it.each([undefined, null, 18, '', '  ', '*'])('ignores %s', (value) => {
      expect(toConstraints('node', value, '*')).toBeUndefined();
    });

    it('keeps `*` unless it is ignored', () => {
      expect(toConstraints('node', '*')).toEqual({ node: '*' });
    });
  });

  describe('isRubyVersion', () => {
    // `2.5-6` is a prerelease for Gem::Version, like `2.5.pre.6`
    it.each(['2.5.6', '2.6.0.rc1', '1.0.pre', '2.3.26.1', '7', '2.5-6'])(
      'accepts %s',
      (version) => {
        expect(isRubyVersion(version)).toBe(true);
      },
    );

    it.each(['', 'v2.5.6', '2..5', 'rc1'])('rejects %s', (version) => {
      expect(isRubyVersion(version)).toBe(false);
    });
  });

  describe('compareRuby', () => {
    it('sorts like Gem::Version', () => {
      const sorted = [
        '2.10.0',
        '2.5.9',
        '2.5.10',
        '2.6.0.rc2',
        '2.6.0.rc1',
        '2.6.0.pre',
        '2.6.0',
        '2.6.0.1',
        '2.6',
        '1.17.3',
      ].sort(compareRuby);

      // 2.6 equals 2.6.0, the sort is stable
      expect(sorted).toEqual([
        '1.17.3',
        '2.5.9',
        '2.5.10',
        '2.6.0.pre',
        '2.6.0.rc1',
        '2.6.0.rc2',
        '2.6.0',
        '2.6',
        '2.6.0.1',
        '2.10.0',
      ]);
    });

    it('treats missing segments as zero', () => {
      expect(compareRuby('2.6', '2.6.0')).toBe(0);
      expect(compareRuby('1.0.0.rc1', '1.0.0')).toBeLessThan(0);
      expect(compareRuby('1.0.0', '1.0.0.rc1')).toBeGreaterThan(0);
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
