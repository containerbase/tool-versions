import { describe, expect, it } from 'vitest';
import { compareDocker, compareMaven, compareNuget, versionings } from './versioning.ts';

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

  describe('versionings', () => {
    it.each([
      ['semver', '1.2.3', true, false],
      ['semver', '1.2.3-rc.1', true, true],
      ['semver', '1.2', false, false],
      ['docker', '28.5.0.7', true, false],
      ['docker', '1.2-rc1', true, true],
      ['docker', 'v1.2', false, false],
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
      ['pep440', '2.1.0b1', true, true],
      ['pep440', '2.1.0', true, false],
    ] as const)('%s %s: valid %s, prerelease %s', (name, version, valid, prerelease) => {
      const { isValid, isPrerelease } = versionings[name];

      expect([isValid(version), valid && isPrerelease(version)]).toEqual([valid, prerelease]);
    });
  });
});
