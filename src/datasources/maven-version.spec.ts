import { stdout } from 'node:process';

import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ToolFile } from '../schema.ts';
import { fetchMavenVersions } from './maven-version.ts';

const central = 'https://repo.maven.apache.org';
const path = '/maven2/org/apache/maven/apache-maven';
const prebuildHost = 'https://github.com';
const prebuildPath = '/containerbase/maven-prebuild/releases/download';

/**
 * A `maven-metadata.xml` with versions.
 * @param versions - the listed versions
 */
function metadata(...versions: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<metadata>',
    '  <groupId>org.apache.maven</groupId>',
    '  <artifactId>apache-maven</artifactId>',
    '  <versioning>',
    '    <latest>4.0.0-rc-7</latest>',
    '    <release>4.0.0-rc-7</release>',
    '    <versions>',
    ...versions.map((version) => `      <version>${version}</version>`),
    '    </versions>',
    '    <lastUpdated>20260101000000</lastUpdated>',
    '  </versioning>',
    '</metadata>',
  ].join('\n');
}

/**
 * The Apache file of a version.
 * @param version - the version
 * @param checksum - the published checksum
 */
function apache(version: string, checksum: string): ToolFile {
  const name = `apache-maven-${version}-bin.tar.gz`;
  return { name, url: `${central}${path}/${version}/${name}`, checksum };
}

/**
 * The prebuild file of a version.
 * @param version - the version
 */
function prebuild(version: string): ToolFile {
  const name = `maven-${version}.tar.xz`;
  return {
    name,
    url: `${prebuildHost}${prebuildPath}/${version}/${name}`,
    checksum: `sha512:${'d'.repeat(128)}`,
  };
}

/**
 * Mocks the releases of the maven prebuilds.
 * @param versions - the versions with a prebuild release
 */
function mockPrebuilds(...versions: string[]): void {
  nock('https://api.github.com')
    .get('/repos/containerbase/maven-prebuild/releases')
    .query({ per_page: '100' })
    .reply(
      200,
      versions.map((version) => ({
        tag_name: version,
        draft: false,
        prerelease: false,
        published_at: '2026-01-02T03:04:05Z',
        assets: [`maven-${version}.tar.xz`, `maven-${version}.tar.xz.sha512`].map((name) => ({
          name,
          browser_download_url: `${prebuildHost}${prebuildPath}/${version}/${name}`,
        })),
      })),
    );
}

describe('datasources/maven-version', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('lists the Apache file of every version and the prebuild file where there is one', async () => {
    nock(central)
      .get(`${path}/maven-metadata.xml`)
      .reply(200, metadata('3.0', '3.0.4', '3.9.9', '4.0.0-rc-7'))
      .get(`${path}/3.0/apache-maven-3.0-bin.tar.gz.sha512`)
      .reply(404)
      .get(`${path}/3.0/apache-maven-3.0-bin.tar.gz.sha1`)
      .reply(200, 'e'.repeat(40))
      .get(`${path}/3.0.4/apache-maven-3.0.4-bin.tar.gz.sha512`)
      .reply(404)
      .get(`${path}/3.0.4/apache-maven-3.0.4-bin.tar.gz.sha1`)
      .reply(200, 'A'.repeat(40), { 'Last-Modified': 'Mon, 21 Jan 2013 12:00:00 GMT' })
      .get(`${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512`)
      .reply(200, `${'b'.repeat(128)}  apache-maven-3.9.9-bin.tar.gz`, {
        'Last-Modified': 'Wed, 07 Aug 2024 10:11:12 GMT',
      })
      .get(`${path}/4.0.0-rc-7/apache-maven-4.0.0-rc-7-bin.tar.gz.sha512`)
      .reply(200, 'c'.repeat(128), { 'Last-Modified': 'invalid' });
    // the prebuild release time is not used
    mockPrebuilds('3.9.9');
    nock(prebuildHost)
      .get(`${prebuildPath}/3.9.9/maven-3.9.9.tar.xz.sha512`)
      .reply(200, 'd'.repeat(128));

    await expect(fetchMavenVersions('maven', new Set())).resolves.toEqual([
      {
        version: '4.0.0-rc-7',
        prerelease: true,
        files: [apache('4.0.0-rc-7', `sha512:${'c'.repeat(128)}`)],
      },
      {
        version: '3.9.9',
        releaseTimestamp: '2024-08-07T10:11:12.000Z',
        files: [apache('3.9.9', `sha512:${'b'.repeat(128)}`), prebuild('3.9.9')],
      },
      {
        version: '3.0.4',
        releaseTimestamp: '2013-01-21T12:00:00.000Z',
        files: [apache('3.0.4', `sha1:${'a'.repeat(40)}`)],
      },
      { version: '3.0', files: [apache('3.0', `sha1:${'e'.repeat(40)}`)] },
    ]);
  });

  it('reuses the known files and release times and skips the versions below the minimum', async () => {
    const known = [apache('3.9.9', `sha512:${'b'.repeat(128)}`), prebuild('3.9.9')];
    nock(central).get(`${path}/maven-metadata.xml`).reply(200, metadata('2.0.9', '3.9.9'));
    // the release is listed again, but nothing is requested for its known files
    mockPrebuilds('3.9.9');

    await expect(
      fetchMavenVersions(
        'maven',
        new Set(),
        new Map([['3.9.9', known]]),
        undefined,
        true,
        new Set(['3.9.9']),
        'maven',
        '3.0.4',
      ),
    ).resolves.toEqual([{ version: '3.9.9', files: known }]);
  });

  it('reads only the release time of a version with known files', async () => {
    const known = [apache('3.9.9', `sha512:${'b'.repeat(128)}`)];
    nock(central)
      .get(`${path}/maven-metadata.xml`)
      .reply(200, metadata('3.9.9'))
      .get(`${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512`)
      .reply(200, 'f'.repeat(128), { 'Last-Modified': 'Wed, 07 Aug 2024 10:11:12 GMT' });
    mockPrebuilds();

    await expect(
      fetchMavenVersions('maven', new Set(), new Map([['3.9.9', known]])),
    ).resolves.toEqual([
      { version: '3.9.9', releaseTimestamp: '2024-08-07T10:11:12.000Z', files: known },
    ]);
  });

  it('keeps the Apache files and warns when the prebuild releases fail', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    nock(central)
      .get(`${path}/maven-metadata.xml`)
      .reply(200, metadata('3.9.9'))
      .get(`${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512`)
      .reply(200, 'b'.repeat(128));
    nock('https://api.github.com')
      .get('/repos/containerbase/maven-prebuild/releases')
      .query({ per_page: '100' })
      .times(3)
      .reply(500);

    await expect(fetchMavenVersions('maven', new Set())).resolves.toEqual([
      { version: '3.9.9', files: [apache('3.9.9', `sha512:${'b'.repeat(128)}`)] },
    ]);
    expect(output).toEqual([
      '::warning::maven: no prebuild files: HttpError: GET https://api.github.com/repos/containerbase/maven-prebuild/releases?per_page=100 failed with status 500\n',
    ]);
  });

  it('warns about an invalid digest and skips a version without checksum files', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    mockPrebuilds();
    nock(central)
      .get(`${path}/maven-metadata.xml`)
      .reply(200, metadata('3.9.8', '3.9.9'))
      .get(`${path}/3.9.8/apache-maven-3.9.8-bin.tar.gz.sha512`)
      .reply(404)
      .get(`${path}/3.9.8/apache-maven-3.9.8-bin.tar.gz.sha1`)
      .reply(404)
      .get(`${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512`)
      .reply(200, 'invalid');

    await expect(fetchMavenVersions('maven', new Set())).resolves.toEqual([
      { version: '3.9.9' },
      { version: '3.9.8' },
    ]);
    expect(output).toEqual([
      `::warning::maven: no valid sha512 digest in ${central}${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512\n`,
    ]);
  });

  it('warns about a failed checksum download and does not fall back to sha1', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    mockPrebuilds();
    nock(central)
      .get(`${path}/maven-metadata.xml`)
      .reply(200, metadata('3.9.9'))
      .get(`${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512`)
      .reply(403);

    await expect(fetchMavenVersions('maven', new Set())).resolves.toEqual([{ version: '3.9.9' }]);
    expect(output).toEqual([
      `::warning::maven: no checksum from ${central}${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512: HttpError: GET ${central}${path}/3.9.9/apache-maven-3.9.9-bin.tar.gz.sha512 failed with status 403\n`,
    ]);
  });

  it('reads a single version and requests no files when told not to', async () => {
    nock(central).get(`${path}/maven-metadata.xml`).reply(200, metadata('3.9.9'));

    await expect(
      fetchMavenVersions('maven', new Set(), undefined, undefined, false),
    ).resolves.toEqual([{ version: '3.9.9' }]);
  });

  it('fails on an error response', async () => {
    nock(central).get(`${path}/maven-metadata.xml`).times(3).reply(500);

    await expect(fetchMavenVersions('maven', new Set())).rejects.toThrow(
      `GET ${central}${path}/maven-metadata.xml failed with status 500`,
    );
  });
});
