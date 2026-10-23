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

  describe('versionings of the tools', () => {
    it.each([
      // swift
      [
        'semver-coerced',
        ['6.1', '6.0.3', '6.0', '5.10.1', '6.0.1', '5.10'],
        ['5.10', '5.10.1', '6.0', '6.0.1', '6.0.3', '6.1'],
      ],
      // protoc
      ['semver-coerced', ['29.0', '3.21.12', '28.3', '25.1'], ['3.21.12', '25.1', '28.3', '29.0']],
      // android-sdk-cmdline-tools
      ['semver-coerced', ['13', '9', '14.1', '12.1.2', '11'], ['9', '11', '12.1.2', '13', '14.1']],
      // ghc and cabal
      [
        'pvp',
        ['9.8.2', '9.6.0.20230210', '9.10.1', '9.8.1'],
        ['9.6.0.20230210', '9.8.1', '9.8.2', '9.10.1'],
      ],
      [
        'pvp',
        ['3.18.0.0', '3.10.3.0', '3.14.1.1', '3.14.1.0'],
        ['3.10.3.0', '3.14.1.0', '3.14.1.1', '3.18.0.0'],
      ],
      // composer and php
      [
        'composer',
        ['8.3.10', '8.3.9', '2.9.0-RC1', '2.8.12'],
        ['2.8.12', '2.9.0-RC1', '8.3.9', '8.3.10'],
      ],
      // pixi
      ['conda', ['0.40.0', '0.9.1', '0.40.1'], ['0.9.1', '0.40.0', '0.40.1']],
      // terraform
      [
        'hashicorp',
        ['1.10.0', '1.10.0-rc1', '1.9.8', '1.10.0-beta1'],
        ['1.9.8', '1.10.0-beta1', '1.10.0-rc1', '1.10.0'],
      ],
    ] as const)('sorts %s versions', (name, versions, sorted) => {
      expect([...versions].sort(versionings[name].compare)).toEqual(sorted);
    });

    it.each([
      ['semver-coerced', '29.0-rc1', true, true],
      ['semver-coerced', '6.0', true, false],
      // a fourth part makes it no stable semver version
      ['semver-coerced', '28.5.0.10', true, true],
      ['semver-coerced', 'foo', false, false],
      ['pvp', '9.6.0.20230210', true, false],
      ['composer', '2.9.0-RC1', true, true],
      ['composer', '8.3.10', true, false],
      ['deno', '2.1.0', true, false],
      ['deno', '2.1.0-rc.1', true, true],
      ['conda', '0.40.0', true, false],
      ['hashicorp', '1.10.0-rc1', true, true],
      ['hashicorp', '1.9.8', true, false],
      ['npm', '3.6.0-216.1.beta', true, true],
    ] as const)('%s %s: valid %s, prerelease %s', (name, version, valid, prerelease) => {
      const { isValid, isPrerelease } = versionings[name];

      expect([isValid(version), valid && isPrerelease(version)]).toEqual([valid, prerelease]);
    });

    it('compares a prerelease equal to its release once coerced', () => {
      expect(versionings['semver-coerced'].compare('29.0-rc1', '29.0')).toBe(0);
      expect(versionings['semver-coerced'].compare('28.5.0.7', '28.5.0.10')).toBe(0);
    });

    it.each([
      // swift, also the resolute minimum `6.4.0`
      ['semver-coerced', '5.7', ['5.7', '5.7.1', '5.7.3', '5.8'], ['5.6.3']],
      ['semver-coerced', '6.4.0', ['6.4', '6.4.1'], ['6.3.1']],
      // protoc
      ['semver-coerced', '3.0.0', ['3.0.0', '3.21.12', '25.1'], ['2.6.1']],
      // ghc
      ['pvp', '8.10.1', ['8.10.1', '8.10.7', '9.8.2'], ['8.8.4']],
      // cabal
      ['pvp', '3.4.1.0', ['3.4.1.0', '3.10.3.0', '3.18.0.0'], ['3.4.0.0', '3.2.0.0']],
    ] as const)('keeps the %s versions from the minimum %s', (name, min, kept, dropped) => {
      const isTooOld = belowMinimum(name, min);

      expect(versionings[name].isValid(min)).toBe(true);
      expect([...kept, ...dropped].map(isTooOld)).toEqual([
        ...kept.map(() => false),
        ...dropped.map(() => true),
      ]);
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
