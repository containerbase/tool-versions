import { stdout } from 'node:process';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolFile } from '../schema.ts';
import { fetchHashicorpReleases } from './hashicorp-releases.ts';

const host = 'https://releases.hashicorp.com';
const sum = (char: string): string => char.repeat(64);

/**
 * The index entry of a release.
 * @param version - the version
 * @param platforms - the `<os>_<arch>` builds
 */
function release(
  version: string,
  platforms: string[],
): { shasums: string; builds: { os: string; arch: string; filename: string; url: string }[] } {
  return {
    shasums: `terraform_${version}_SHA256SUMS`,
    builds: platforms.map((platform) => {
      const [os = '', arch = ''] = platform.split('_');
      const filename = `terraform_${version}_${platform}.zip`;
      return { os, arch, filename, url: `${host}/terraform/${version}/${filename}` };
    }),
  };
}

/**
 * The published file of a build.
 * @param version - the version
 * @param arch - the arch
 * @param char - the character of the digest
 */
function file(version: string, arch: 'amd64' | 'arm64', char: string): ToolFile {
  const name = `terraform_${version}_linux_${arch}.zip`;
  return {
    name,
    url: `${host}/terraform/${version}/${name}`,
    checksum: `sha256:${sum(char)}`,
    arch,
  };
}

describe('datasources/hashicorp-releases', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('lists the linux amd64 and arm64 zips with the checksums of the SHA256SUMS', async () => {
    nock(host)
      .get('/terraform/index.json')
      .reply(200, {
        name: 'terraform',
        versions: {
          '1.5.0': release('1.5.0', ['linux_amd64', 'linux_arm64', 'darwin_arm64', 'linux_386']),
          '1.6.0-rc1': release('1.6.0-rc1', ['linux_amd64']),
          '1.10.0': release('1.10.0', ['linux_amd64', 'linux_arm64']),
          'not-a-version': release('x', []),
        },
      })
      .get('/terraform/1.5.0/terraform_1.5.0_SHA256SUMS')
      .reply(
        200,
        [
          `${sum('a')}  terraform_1.5.0_linux_amd64.zip`,
          `${sum('b')}  terraform_1.5.0_linux_arm64.zip`,
          `${sum('c')}  terraform_1.5.0_darwin_arm64.zip`,
        ].join('\n'),
      )
      .get('/terraform/1.6.0-rc1/terraform_1.6.0-rc1_SHA256SUMS')
      .reply(200, `${sum('d')}  terraform_1.6.0-rc1_linux_amd64.zip\n`)
      .get('/terraform/1.10.0/terraform_1.10.0_SHA256SUMS')
      .reply(
        200,
        `${sum('e')}  terraform_1.10.0_linux_amd64.zip\n${sum('f')}  terraform_1.10.0_linux_arm64.zip\n`,
      );

    await expect(fetchHashicorpReleases('terraform')).resolves.toEqual([
      { version: '1.10.0', files: [file('1.10.0', 'amd64', 'e'), file('1.10.0', 'arm64', 'f')] },
      { version: '1.6.0-rc1', prerelease: true, files: [file('1.6.0-rc1', 'amd64', 'd')] },
      { version: '1.5.0', files: [file('1.5.0', 'amd64', 'a'), file('1.5.0', 'arm64', 'b')] },
    ]);
  });

  it('only reads the checksums of versions with missing files', async () => {
    nock(host)
      .get('/terraform/index.json')
      .reply(200, {
        versions: {
          '1.10.0': release('1.10.0', ['linux_amd64', 'linux_arm64']),
          '1.9.0': release('1.9.0', ['linux_amd64', 'linux_arm64']),
        },
      })
      .get('/terraform/1.9.0/terraform_1.9.0_SHA256SUMS')
      .reply(200, `${sum('b')}  terraform_1.9.0_linux_arm64.zip\n`);
    const previous = new Map([
      ['1.10.0', [file('1.10.0', 'amd64', 'e'), file('1.10.0', 'arm64', 'f')]],
      ['1.9.0', [file('1.9.0', 'amd64', 'a')]],
    ]);

    await expect(fetchHashicorpReleases('terraform', undefined, previous)).resolves.toEqual([
      { version: '1.10.0', files: [file('1.10.0', 'amd64', 'e'), file('1.10.0', 'arm64', 'f')] },
      { version: '1.9.0', files: [file('1.9.0', 'amd64', 'a'), file('1.9.0', 'arm64', 'b')] },
    ]);
  });

  it('skips a release without checksum file silently and warns on other failures', async () => {
    const output: string[] = [];
    vi.spyOn(stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    nock(host)
      .get('/terraform/index.json')
      .reply(200, {
        versions: {
          '1.1.0': release('1.1.0', ['linux_amd64']),
          '1.0.0': release('1.0.0', ['linux_amd64']),
        },
      })
      .get('/terraform/1.1.0/terraform_1.1.0_SHA256SUMS')
      .reply(404)
      .get('/terraform/1.0.0/terraform_1.0.0_SHA256SUMS')
      .reply(403);

    await expect(fetchHashicorpReleases('terraform')).resolves.toEqual([
      { version: '1.1.0' },
      { version: '1.0.0' },
    ]);
    expect(output).toEqual([
      `::warning::terraform: no checksum from ${host}/terraform/1.0.0/terraform_1.0.0_SHA256SUMS: HttpError: GET ${host}/terraform/1.0.0/terraform_1.0.0_SHA256SUMS failed with status 403\n`,
    ]);
  });

  it('fetches no files when told so', async () => {
    nock(host)
      .get('/terraform/index.json')
      .reply(200, { versions: { '1.5.0': release('1.5.0', ['linux_amd64']) } });

    await expect(
      fetchHashicorpReleases('terraform', undefined, undefined, undefined, false),
    ).resolves.toEqual([{ version: '1.5.0' }]);
  });

  it('fails on an error response', async () => {
    nock(host).get('/terraform/index.json').reply(404);

    await expect(fetchHashicorpReleases('terraform')).rejects.toThrow('failed with status 404');
  });
});
