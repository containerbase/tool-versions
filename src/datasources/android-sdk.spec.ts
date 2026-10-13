import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchAndroidSdkVersions } from './android-sdk.ts';

const host = 'https://dl.google.com';
const path = '/android/repository/repository2-3.xml';
const sha1 = 'a'.repeat(40);

/**
 * A remote package of the repository.
 * @param id - the path of the package, like `cmdline-tools;13.0`
 * @param revision - the revision xml
 * @param channel - the channel reference
 * @param archives - the archives xml
 */
function remotePackage(id: string, revision: string, channel: string, archives: string): string {
  return `
  <remotePackage path="${id}">
    <type-details xsi:type="ns5:genericDetailsType" xmlns:ns5="http://schemas.android.com/repository/android/generic/02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
    <revision>${revision}</revision>
    <display-name>Android SDK Command-line Tools</display-name>
    <uses-license ref="android-sdk-license"/>
    <channelRef ref="${channel}"/>
    <archives>${archives}</archives>
  </remotePackage>`;
}

/**
 * An archive of a package.
 * @param os - the host os
 * @param url - the file name
 * @param type - the checksum type
 * @param checksum - the digest
 */
function archive(os: string, url: string, type: string, checksum: string): string {
  return `
      <archive>
        <complete>
          <size>158452866</size>
          <checksum type="${type}">${checksum}</checksum>
          <url>${url}</url>
        </complete>
        <host-os>${os}</host-os>
      </archive>`;
}

/**
 * A repository document.
 * @param packages - the remote packages
 */
function repository(...packages: string[]): string {
  return `<?xml version="1.0" ?>
<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/sdk/android/repo/repository2/03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <license id="android-sdk-license" type="text">Terms and Conditions</license>
  <channel id="channel-0">stable</channel>
  <channel id="channel-1">beta</channel>${packages.join('')}
</sdk:sdk-repository>`;
}

describe('datasources/android-sdk', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('lists the cmdline-tools versions with their linux archive and checksum', async () => {
    nock(host)
      .get(path)
      .reply(
        200,
        repository(
          remotePackage(
            'cmdline-tools;13.0',
            '<major>13</major><minor>0</minor>',
            'channel-0',
            archive('linux', 'commandlinetools-linux-13114758_latest.zip', 'sha1', sha1) +
              archive('macosx', 'commandlinetools-mac-13114758_latest.zip', 'sha1', 'deadbeef'),
          ),
          remotePackage(
            'cmdline-tools;12.0',
            '<major>12</major><minor>1</minor><micro>2</micro>',
            'channel-0',
            archive('linux', 'commandlinetools-linux-12.zip', 'sha256', 'B'.repeat(64)),
          ),
          remotePackage(
            'cmdline-tools;14.0-alpha01',
            '<major>14</major><minor>0</minor><preview>1</preview>',
            'channel-1',
            archive('linux', 'commandlinetools-linux-14-alpha.zip', 'sha1', sha1),
          ),
          remotePackage(
            'cmdline-tools;latest',
            '<major>13</major><minor>0</minor>',
            'channel-0',
            archive('linux', 'commandlinetools-linux-latest.zip', 'sha1', sha1),
          ),
          remotePackage(
            'cmdline-tools;11.0',
            '<major>11</major><minor>0</minor>',
            'channel-0',
            archive('windows', 'commandlinetools-win-11.zip', 'sha1', sha1),
          ),
          remotePackage(
            'platform-tools',
            '<major>35</major>',
            'channel-0',
            archive('linux', 'platform-tools.zip', 'sha1', sha1),
          ),
        ),
      );

    await expect(fetchAndroidSdkVersions('cmdline-tools')).resolves.toEqual([
      // the zero minor is left out of 13.0 and the preview is the last part
      {
        version: '14.1',
        prerelease: true,
        files: [
          {
            name: 'commandlinetools-linux-14-alpha.zip',
            url: `${host}/android/repository/commandlinetools-linux-14-alpha.zip`,
            checksum: `sha1:${sha1}`,
          },
        ],
      },
      {
        version: '13',
        files: [
          {
            name: 'commandlinetools-linux-13114758_latest.zip',
            url: `${host}/android/repository/commandlinetools-linux-13114758_latest.zip`,
            checksum: `sha1:${sha1}`,
          },
        ],
      },
      {
        version: '12.1.2',
        files: [
          {
            name: 'commandlinetools-linux-12.zip',
            url: `${host}/android/repository/commandlinetools-linux-12.zip`,
            checksum: `sha256:${'b'.repeat(64)}`,
          },
        ],
      },
      // no linux archive
      { version: '11' },
    ]);
  });

  it('reads a repository with a single package and a single archive', async () => {
    nock(host)
      .get(path)
      .reply(
        200,
        repository(
          remotePackage(
            'cmdline-tools;9.0',
            '<major>9</major><minor>0</minor>',
            'channel-0',
            archive('linux', 'commandlinetools-linux-9.zip', 'sha1', sha1),
          ),
        ),
      );

    await expect(fetchAndroidSdkVersions('cmdline-tools')).resolves.toMatchObject([
      { version: '9', files: [{ name: 'commandlinetools-linux-9.zip' }] },
    ]);
  });

  it('publishes no files when told so, and skips unknown checksum types', async () => {
    nock(host)
      .get(path)
      .times(2)
      .reply(
        200,
        repository(
          remotePackage(
            'cmdline-tools;9.0',
            '<major>9</major>',
            'channel-0',
            archive('linux', 'commandlinetools-linux-9.zip', 'md5', 'a'.repeat(32)),
          ),
          remotePackage(
            'cmdline-tools;8.0',
            '<major>8</major>',
            'channel-0',
            archive('linux', 'commandlinetools-linux-8.zip', 'sha1', sha1),
          ),
        ),
      );

    await expect(fetchAndroidSdkVersions('cmdline-tools')).resolves.toMatchObject([
      { version: '9' },
      { version: '8', files: [{ checksum: `sha1:${sha1}` }] },
    ]);
    await expect(
      fetchAndroidSdkVersions('cmdline-tools', undefined, undefined, undefined, false),
    ).resolves.toEqual([{ version: '9' }, { version: '8' }]);
  });

  it('fails on an error response', async () => {
    nock(host).get(path).reply(404);

    await expect(fetchAndroidSdkVersions('cmdline-tools')).rejects.toThrow(
      'failed with status 404',
    );
  });

  it('fails for a document which is no repository', async () => {
    nock(host).get(path).reply(200, '<html><body/></html>');

    await expect(fetchAndroidSdkVersions('cmdline-tools')).rejects.toThrow();
  });
});
