import { describe, expect, it } from 'vitest';
import { Formats, PreviousToolVersions, ToolFile, ToolVersion, ToolVersions } from './schema.ts';

const file = {
  name: 'python-3.14.8-jammy-x86_64.tar.xz',
  url: 'https://github.com/containerbase/python-prebuild/releases/download/3.14.8/python-3.14.8-jammy-x86_64.tar.xz',
  checksum: `sha512:${'a'.repeat(128)}`,
  arch: 'amd64',
  distro: 'jammy',
};

describe('schema', () => {
  describe('ToolFile', () => {
    it('accepts sha1, sha256 and sha512 checksums', () => {
      expect(ToolFile.parse(file)).toEqual(file);
      const sha256 = { name: 'a.tgz', url: file.url, checksum: `sha256:${'b'.repeat(64)}` };
      expect(ToolFile.parse(sha256)).toEqual(sha256);
      const sha1 = { name: 'a.zip', url: file.url, checksum: `sha1:${'c'.repeat(40)}` };
      expect(ToolFile.parse(sha1)).toEqual(sha1);
    });

    it.each([
      ['ab12'],
      ['sha256:ab12'],
      ['sha1:' + 'a'.repeat(39)],
      ['sha1:' + 'A'.repeat(40)],
      ['md5:' + 'a'.repeat(32)],
      [`sha512:${'a'.repeat(64)}`],
      [`sha256:${'A'.repeat(64)}`],
      [`sha256:${'x'.repeat(64)}`],
    ])('rejects the checksum %s', (checksum) => {
      expect(ToolFile.safeParse({ ...file, checksum }).success).toBe(false);
    });

    it('rejects a non-https url, an unknown arch and a missing name', () => {
      expect(ToolFile.safeParse({ ...file, url: 'http://example.com/a' }).success).toBe(false);
      expect(ToolFile.safeParse({ ...file, arch: 'x86_64' }).success).toBe(false);
      expect(ToolFile.safeParse({ ...file, name: '' }).success).toBe(false);
    });
  });

  describe('ToolVersions', () => {
    const data = {
      tool: 'node',
      source: { datasource: 'node-version', packageName: 'node', versioning: 'node' },
      updatedAt: '2026-10-08T12:00:00.000Z',
      versions: [],
    };

    it('accepts the links, which are optional', () => {
      const links = { sourceUrl: 'https://github.com/nodejs/node', homepage: 'https://nodejs.org' };
      expect(ToolVersions.parse({ ...data, ...links })).toEqual({ ...data, ...links });
      expect(ToolVersions.parse(data)).toEqual(data);
      expect(PreviousToolVersions.parse(data)).toEqual(data);
    });

    it('accepts a $schema, which is optional, and rejects a non-https one', () => {
      const $schema = 'https://containerbase.github.io/tool-versions/v1/tool.schema.json';
      expect(ToolVersions.parse({ $schema, ...data })).toEqual({ $schema, ...data });
      expect(
        ToolVersions.safeParse({ ...data, $schema: 'http://example.com/a.json' }).success,
      ).toBe(false);
    });

    it('accepts the minimum versions, with any distro codename', () => {
      const minimums = {
        minVersion: '7.4.0',
        distroMinVersion: { resolute: '8.1.31', sid: '9.0' },
      };
      expect(ToolVersions.parse({ ...data, ...minimums })).toEqual({ ...data, ...minimums });
      expect(ToolVersions.safeParse({ ...data, distroMinVersion: { resolute: 8 } }).success).toBe(
        false,
      );
    });

    it('accepts the lts flag only as true', () => {
      expect(ToolVersions.parse({ ...data, lts: true })).toEqual({ ...data, lts: true });
      expect(ToolVersions.safeParse({ ...data, lts: false }).success).toBe(false);
    });

    it('accepts the latest version, but no empty one', () => {
      expect(ToolVersions.parse({ ...data, latest: '9.0.0' })).toEqual({
        ...data,
        latest: '9.0.0',
      });
      expect(ToolVersions.safeParse({ ...data, latest: '' }).success).toBe(false);
    });

    it('accepts the minCb ranges', () => {
      const minCb = [{ version: '0.6.0.1', cb: '14.51.0' }];
      expect(ToolVersions.parse({ ...data, minCb })).toEqual({ ...data, minCb });
    });

    it.each([
      [[]],
      [[{ version: '', cb: '14.51.0' }]],
      [[{ version: '1.0.0', cb: 'v14.51.0' }]],
      [[{ version: '1.0.0', cb: '14' }]],
      [[{ version: '1.0.0', cb: ' 14.51.0' }]],
      [[{ version: '1.0.0', cb: 'latest' }]],
      [[{ version: '1.0.0', cb: '14.51.0+build' }]],
    ])('rejects the minCb %j', (minCb) => {
      expect(ToolVersions.safeParse({ ...data, minCb }).success).toBe(false);
    });

    it.each(['sourceUrl', 'homepage'])('rejects a non-https %s', (field) => {
      expect(ToolVersions.safeParse({ ...data, [field]: 'http://example.com' }).success).toBe(
        false,
      );
      expect(ToolVersions.safeParse({ ...data, [field]: 'nodejs.org' }).success).toBe(false);
    });
  });

  describe('Formats', () => {
    it('accepts the status values and the removal date of a deprecated format', () => {
      const formats = {
        $schema: 'https://containerbase.github.io/tool-versions/formats.schema.json',
        defaultDistro: 'noble',
        formats: [
          { version: 1, path: 'v1/', status: 'deprecated', removalDate: '2027-01-31' },
          { version: 2, path: 'v2/', status: 'current' },
          { version: 3, path: 'v3/', status: 'preview' },
        ],
      };
      expect(Formats.parse(formats)).toEqual(formats);
    });

    it.each([
      { version: 1, path: 'v1/', status: 'old' },
      { version: 0, path: 'v0/', status: 'current' },
      { version: 1, path: '', status: 'current' },
      { version: 1, path: 'v1/', status: 'deprecated', removalDate: 'soon' },
    ])('rejects the format %j', (format) => {
      expect(Formats.safeParse({ defaultDistro: 'noble', formats: [format] }).success).toBe(false);
    });

    it('requires the default distro', () => {
      expect(Formats.safeParse({ formats: [] }).success).toBe(false);
    });
  });

  describe('ToolVersion', () => {
    it('accepts files', () => {
      const version = { version: '3.14.8', files: [file] };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it('accepts a version without files', () => {
      expect(ToolVersion.parse({ version: '3.14.8' })).toEqual({ version: '3.14.8' });
    });

    it('accepts the deprecated flag only as true', () => {
      const version = { version: '9.0.0', deprecated: true };
      expect(ToolVersion.parse(version)).toEqual(version);
      expect(ToolVersion.safeParse({ ...version, deprecated: false }).success).toBe(false);
    });

    it('accepts a release timestamp', () => {
      const version = { version: '3.14.8', releaseTimestamp: '2025-10-28T00:00:00.000Z' };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it.each(['2025-10-28', 'yesterday', '2025-10-28T00:00:00+02:00'])(
      'rejects the release timestamp %s',
      (releaseTimestamp) => {
        expect(ToolVersion.safeParse({ version: '3.14.8', releaseTimestamp }).success).toBe(false);
      },
    );

    it('accepts constraints', () => {
      const version = { version: '12.0.0', constraints: { node: '^20.17.0 || >=22.9.0' } };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it('rejects empty constraints', () => {
      expect(ToolVersion.safeParse({ version: '12.0.0', constraints: { node: '' } }).success).toBe(
        false,
      );
      expect(ToolVersion.safeParse({ version: '12.0.0', constraints: { '': '>=1' } }).success).toBe(
        false,
      );
    });

    it('accepts archs', () => {
      const version = { version: '3.14.8', archs: ['amd64', 'arm64'] };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it.each([[[]], [['x86_64']]])('rejects the archs %j', (archs) => {
      expect(ToolVersion.safeParse({ version: '3.14.8', archs }).success).toBe(false);
    });

    it('accepts distros', () => {
      const version = { version: '3.14.8', distros: ['jammy', 'noble'] };
      expect(ToolVersion.parse(version)).toEqual(version);
    });

    it.each([[[]], [['']]])('rejects the distros %j', (distros) => {
      expect(ToolVersion.safeParse({ version: '3.14.8', distros }).success).toBe(false);
    });

    it('rejects an empty file list', () => {
      expect(ToolVersion.safeParse({ version: '3.14.8', files: [] }).success).toBe(false);
    });
  });
});
