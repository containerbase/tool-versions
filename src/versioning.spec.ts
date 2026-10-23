import { describe, expect, it } from 'vitest';
import { belowMinimum, nightlyDate, versionings } from './versioning.ts';

describe('versioning', () => {
  describe('versionings', () => {
    it.each([
      ['semver', '1.2.3', true, false],
      ['semver', '1.2.3-rc.1', true, true],
      ['semver', '1.2', false, false],
      ['docker', '28.5.0.7', true, false],
      ['docker', '1.2rc1', true, true],
      // a `-suffix` is a variant like `-alpine`, not a prerelease
      ['docker', '1.2-rc1', true, false],
      ['docker', 'v1.2', true, false],
      ['docker', '1.2.x', false, false],
      ['loose', '0.6.0.1', true, false],
      ['loose', 'v1.2.3', true, false],
      // loose versions have no prereleases
      ['loose', '1.0.0-beta', true, false],
      ['loose', '1.2.3.4.5.6.7', false, false],
      ['loose', 'abcdef1', false, false],
      ['nuget', '5.257.0.1', true, false],
      ['nuget', '10.0.0-beta.2', true, true],
      ['nuget', '1.2.3.4.5', false, false],
      ['gradle', '8.10', true, false],
      ['gradle', '9.0-rc-1', true, true],
      ['gradle', '8.11-milestone-1', true, true],
      ['gradle', 'abc!', false, false],
      ['maven', '3.9', true, false],
      ['maven', '4.0.0-rc-4', true, true],
      ['maven', 'latest', false, false],
      ['ruby', '3.4.1', true, false],
      ['ruby', '3.5.0.preview1', true, true],
      ['ruby', 'x', false, false],
      ['rust-release-channel', '1.90.0', true, false],
      ['rust-release-channel', 'nightly-2026-10-20', true, true],
      ['rust-release-channel', 'nightly-2026-10', false, false],
      ['pep440', '2.1.0b1', true, true],
      ['pep440', '2.1.0', true, false],
      ['pep440', '>=2.1.0', false, false],
      ['npm', '^1.2.3', false, false],
    ] as const)('%s %s: valid %s, prerelease %s', (name, version, valid, prerelease) => {
      const { isValid, isPrerelease } = versionings[name];

      expect([isValid(version), valid && isPrerelease(version)]).toEqual([valid, prerelease]);
    });

    it.each([
      [
        'docker',
        ['28.5.0.10', '28.10', '28.5', '1.2', '1.2-rc1', '28.5.0.7'],
        // a shorter version is newer than the longer ones it is a prefix of
        ['1.2-rc1', '1.2', '28.5.0.7', '28.5.0.10', '28.5', '28.10'],
      ],
      [
        'loose',
        ['2.1.0', '0.6.0.2', '2.1', '0.6.0.1', '0.6.0'],
        ['0.6.0', '0.6.0.1', '0.6.0.2', '2.1', '2.1.0'],
      ],
      [
        'maven',
        [
          '4.0.0',
          '4.0.0-rc-4',
          '4.0.0-beta-5',
          '4.0.0-alpha-13',
          '4.0.0-alpha-2',
          '3.9.11',
          '3.9.9',
        ],
        [
          '3.9.9',
          '3.9.11',
          '4.0.0-alpha-2',
          '4.0.0-alpha-13',
          '4.0.0-beta-5',
          '4.0.0-rc-4',
          '4.0.0',
        ],
      ],
      [
        'gradle',
        ['9.0', '9.0-rc-2', '9.0-milestone-1', '9.0-rc-1', '8.10', '8.9'],
        ['8.9', '8.10', '9.0-milestone-1', '9.0-rc-1', '9.0-rc-2', '9.0'],
      ],
      [
        'nuget',
        ['1.0.0', '1.0.0-beta.10', '1.0.0-beta.2', '1.0.0-alpha.1', '1.0.0.1', '0.9.9.9'],
        ['0.9.9.9', '1.0.0-alpha.1', '1.0.0-beta.2', '1.0.0-beta.10', '1.0.0', '1.0.0.1'],
      ],
      [
        'ruby',
        ['1.0.0', '1.0.0.rc1', '0.9.10', '0.9.9'],
        ['0.9.9', '0.9.10', '1.0.0.rc1', '1.0.0'],
      ],
      ['pep440', ['2.1.0', '2.1.0b1', '2.0.10', '2.0.9'], ['2.0.9', '2.0.10', '2.1.0b1', '2.1.0']],
      [
        'rust-release-channel',
        ['1.10.0', 'nightly-2026-10-20', '1.9.0', 'nightly-2026-10-19'],
        ['1.9.0', '1.10.0', 'nightly-2026-10-19', 'nightly-2026-10-20'],
      ],
    ] as const)('sorts %s versions', (name, versions, sorted) => {
      expect([...versions].sort(versionings[name].compare)).toEqual(sorted);
    });
  });

  describe('belowMinimum', () => {
    it('finds the versions older than the minimum in the versioning', () => {
      const semver = belowMinimum('semver', '3.1.0');
      expect([semver('3.0.9'), semver('3.1.0'), semver('3.1.0-rc.1'), semver('4.0.0')]).toEqual([
        true,
        false,
        true,
        false,
      ]);
      // docker versions compare the segments as numbers, a shorter version is
      // newer than the longer ones it is a prefix of
      const docker = belowMinimum('docker', '8.10.1');
      expect([docker('8.8.4'), docker('8.10.1'), docker('9.2.0'), docker('8.10')]).toEqual([
        true,
        false,
        false,
        false,
      ]);
    });

    it('does not leave out nightlies below a release as minimum version', () => {
      expect(belowMinimum('rust-release-channel', '1.19.0')('nightly-2026-10-20')).toBe(false);
      expect(belowMinimum('rust-release-channel', '1.19.0')('1.18.0')).toBe(true);
    });

    it('finds nothing too old without a minimum', () => {
      expect(belowMinimum('semver')('0.0.1')).toBe(false);
    });

    it('finds nothing too old with a minimum which is no valid version of the versioning', () => {
      expect(belowMinimum('semver', '18.09.0')('1.0.0')).toBe(false);
    });

    it('finds a version which is no valid version of the versioning not too old', () => {
      expect(belowMinimum('node', '8.7.0')('2.0.0~rc1')).toBe(false);
    });
  });

  describe('nightlyDate', () => {
    it('reads the date of a dated nightly only', () => {
      expect(nightlyDate('nightly-2025-11-24')).toBe('2025-11-24');
      expect(nightlyDate('nightly')).toBeUndefined();
      expect(nightlyDate('1.90.0')).toBeUndefined();
    });
  });
});
