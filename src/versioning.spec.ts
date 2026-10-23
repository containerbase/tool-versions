import { describe, expect, it } from 'vitest';
import {
  belowMinimum,
  compareDocker,
  compareLoose,
  compareMaven,
  compareNuget,
  versionings,
} from './versioning.ts';

describe('versioning', () => {
  describe('compareDocker', () => {
    it('compares any number of numeric segments', () => {
      const sorted = ['28.5.0.7', '28.5.0.10', '28.5.0', '27.3.4.9', '28.10', '28.5'].sort(
        compareDocker,
      );

      expect(sorted).toEqual(['27.3.4.9', '28.5.0', '28.5', '28.5.0.7', '28.5.0.10', '28.10']);
    });

    it('sorts a suffix before the release and compares suffixes as text', () => {
      const sorted = ['1.2', '1.2-rc2', '1.2-rc10', '1.2-beta', '1.1'].sort(compareDocker);

      expect(sorted).toEqual(['1.1', '1.2-beta', '1.2-rc10', '1.2-rc2', '1.2']);
      expect(compareDocker('1.2-rc1', '1.2-rc1')).toBe(0);
    });

    it('throws for an invalid version', () => {
      expect(() => compareDocker('1.2', 'x')).toThrow('Invalid docker version x');
    });
  });

  describe('compareLoose', () => {
    it('compares the numeric parts and sorts a missing part first', () => {
      const sorted = ['0.7.0', '0.6.0.2', '2.1.0', '0.6.0.1', '2.1', '0.6.0'].sort(compareLoose);

      expect(sorted).toEqual(['0.6.0', '0.6.0.1', '0.6.0.2', '0.7.0', '2.1', '2.1.0']);
    });

    it('sorts a suffix before the release and compares suffixes naturally', () => {
      const sorted = ['1.0.0', '1.0.0-beta.10', '1.0.0-beta.2'].sort(compareLoose);

      expect(sorted).toEqual(['1.0.0-beta.2', '1.0.0-beta.10', '1.0.0']);
      expect(compareLoose('v1.0.0', '1.0.0')).toBe(0);
    });

    it('throws for an invalid version', () => {
      expect(() => compareLoose('1.0.0', 'abcdef1')).toThrow('Invalid loose version abcdef1');
    });
  });

  describe('compareNuget', () => {
    it('compares up to four numeric parts and prerelease identifiers', () => {
      const sorted = [
        '1.0.0',
        '1.0.0-beta.10',
        '1.0.0-beta.2',
        '1.0.0-beta',
        '1.0.0-alpha.1',
        '1.0.0-1',
        '1.0.0.1',
        '1.0',
        '0.9.9.9',
        '1.0.0+build5',
      ].sort(compareNuget);

      expect(sorted).toEqual([
        '0.9.9.9',
        '1.0.0-1',
        '1.0.0-alpha.1',
        '1.0.0-beta',
        '1.0.0-beta.2',
        '1.0.0-beta.10',
        // equal versions keep their order
        '1.0.0',
        '1.0',
        '1.0.0+build5',
        '1.0.0.1',
      ]);
    });

    it('ignores build metadata and the case of identifiers, and throws for invalid versions', () => {
      expect(compareNuget('1.0.0+a', '1.0.0+b')).toBe(0);
      expect(compareNuget('1.0.0-BETA', '1.0.0-beta')).toBe(0);
      expect(() => compareNuget('1.0.0', 'x')).toThrow('Invalid NuGet version x');
    });
  });

  describe('gradle versions', () => {
    it('orders milestones before release candidates before the release', () => {
      const { compare } = versionings.gradle;

      expect(
        ['8.10', '9.0-rc-2', '9.0', '9.0-milestone-1', '9.0-rc-1', '8.10.1', '8.9'].sort(compare),
      ).toEqual(['8.9', '8.10', '8.10.1', '9.0-milestone-1', '9.0-rc-1', '9.0-rc-2', '9.0']);
    });
  });

  describe('compareMaven', () => {
    it('orders the qualifiers like Maven', () => {
      const sorted = [
        '4.0.0',
        '4.0.0-rc-4',
        '4.0.0-beta-5',
        '4.0.0-alpha-13',
        '4.0.0-alpha-2',
        '3.9.11',
        '3.9.9',
        '3.9',
        '4.0.0-sp1',
        '4.0.0-SNAPSHOT',
      ].sort(compareMaven);

      expect(sorted).toEqual([
        '3.9',
        '3.9.9',
        '3.9.11',
        '4.0.0-alpha-2',
        '4.0.0-alpha-13',
        '4.0.0-beta-5',
        '4.0.0-rc-4',
        '4.0.0-SNAPSHOT',
        '4.0.0',
        '4.0.0-sp1',
      ]);
    });

    it('treats missing items as zero and a short qualifier like its long form', () => {
      expect(compareMaven('3.9', '3.9.0')).toBe(0);
      expect(compareMaven('1.0-b2', '1.0-beta-2')).toBe(0);
      expect(compareMaven('1.0-unknown', '1.0')).toBeGreaterThan(0);
    });
  });

  describe('rust-release-channel', () => {
    it('sorts the nightlies by date above the releases', () => {
      const { compare } = versionings['rust-release-channel'];

      expect(
        ['1.9.0', 'nightly-2026-10-19', '1.10.0', 'nightly-2026-10-20', '1.10.0']
          .sort(compare)
          .reverse(),
      ).toEqual(['nightly-2026-10-20', 'nightly-2026-10-19', '1.10.0', '1.10.0', '1.9.0']);
      expect(compare('nightly-2026-10-19', 'nightly-2026-10-19')).toBe(0);
    });

    it('does not leave out nightlies below a release as minimum version', () => {
      expect(belowMinimum('rust-release-channel', '1.19.0')('nightly-2026-10-20')).toBe(false);
      expect(belowMinimum('rust-release-channel', '1.19.0')('1.18.0')).toBe(true);
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
      // docker versions compare the segments as numbers
      const docker = belowMinimum('docker', '8.10.1');
      expect([docker('8.8.4'), docker('8.10.1'), docker('9.2.0'), docker('8.10')]).toEqual([
        true,
        false,
        false,
        true,
      ]);
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

  describe('versionings', () => {
    it.each([
      ['semver', '1.2.3', true, false],
      ['semver', '1.2.3-rc.1', true, true],
      ['semver', '1.2', false, false],
      ['docker', '28.5.0.7', true, false],
      ['docker', '1.2-rc1', true, true],
      ['docker', 'v1.2', false, false],
      ['loose', '0.6.0.1', true, false],
      ['loose', 'v1.2.3', true, false],
      ['loose', '1.0.0-beta', true, true],
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
      ['rust-release-channel', 'nightly', false, false],
      ['rust-release-channel', 'nightly-2026-10', false, false],
      ['pep440', '2.1.0b1', true, true],
      ['pep440', '2.1.0', true, false],
    ] as const)('%s %s: valid %s, prerelease %s', (name, version, valid, prerelease) => {
      const { isValid, isPrerelease } = versionings[name];

      expect([isValid(version), valid && isPrerelease(version)]).toEqual([valid, prerelease]);
    });
  });
});
