import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPagesUrl, fetchPrevious, pagesUrl } from './previous.ts';
import type { ToolFile, ToolVersions } from './schema.ts';

const previous: ToolVersions = {
  tool: 'helm',
  source: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
  updatedAt: '2026-10-07T03:00:00.000Z',
  versions: [{ version: '4.0.0' }],
};

describe('previous', () => {
  let dir: string | undefined;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(async () => {
    nock.cleanAll();
    vi.unstubAllEnvs();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  describe('release archive', () => {
    const file = (name: string): ToolFile => ({
      name,
      url: `https://example.com/${name}`,
      checksum: `sha256:${'a'.repeat(64)}`,
      arch: 'amd64',
    });
    const source = {
      datasource: 'github-releases',
      packageName: 'helm/helm',
      versioning: 'semver',
    };

    /**
     * Writes an extracted archive with the slim file of helm and the files of two of
     * its three versions.
     */
    async function extractedArchive(): Promise<string> {
      dir = await mkdtemp(join(tmpdir(), 'tool-versions-previous-'));
      await mkdir(join(dir, 'v1', 'helm'), { recursive: true });
      const slim = {
        $schema: 'https://containerbase.github.io/tool-versions/v1/tool.schema.json',
        tool: 'helm',
        source,
        updatedAt: '2026-10-07T03:00:00.000Z',
        versions: [
          { version: '4.0.0', releaseTimestamp: '2026-10-01T00:00:00.000Z' },
          { version: '4.0.0-rc.1', prerelease: true },
          { version: '3.0.0+1' },
        ],
      };
      await writeFile(join(dir, 'v1', 'helm.json'), JSON.stringify(slim));
      for (const version of ['4.0.0', '3.0.0+1']) {
        const files = [file(`helm-${version}.tgz`)];
        await writeFile(
          join(dir, 'v1', 'helm', `${version}.json`),
          JSON.stringify({ tool: 'helm', version, files }),
        );
      }
      return dir;
    }

    it('rebuilds the data of a full file from the slim file and the files of the versions', async () => {
      const archive = await extractedArchive();

      await expect(fetchPrevious('helm', archive)).resolves.toEqual({
        $schema: 'https://containerbase.github.io/tool-versions/v1/tool.schema.json',
        tool: 'helm',
        source,
        updatedAt: '2026-10-07T03:00:00.000Z',
        versions: [
          {
            version: '4.0.0',
            releaseTimestamp: '2026-10-01T00:00:00.000Z',
            files: [file('helm-4.0.0.tgz')],
          },
          // a version without files stays without
          { version: '4.0.0-rc.1', prerelease: true },
          { version: '3.0.0+1', files: [file('helm-3.0.0+1.tgz')] },
        ],
      });
    });

    it('has nothing for a tool which is not in the archive, without asking the site', async () => {
      const archive = await extractedArchive();

      await expect(fetchPrevious('new-tool', archive)).resolves.toBeUndefined();
    });

    it('has nothing for an invalid slim file and ignores an invalid file of a version', async () => {
      const archive = await extractedArchive();
      await writeFile(join(archive, 'v1', 'helm', '4.0.0.json'), '{');
      await writeFile(join(archive, 'v1', 'broken.json'), '{"tool":1}');

      expect(
        (await fetchPrevious('helm', archive))?.versions.map(({ files }) => files?.length),
      ).toEqual([undefined, undefined, 1]);
      await expect(fetchPrevious('broken', archive)).resolves.toBeUndefined();
    });

    it('falls back to the published full file without an archive', async () => {
      vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
      nock('https://fork.example.com').get('/v1/helm.full.json').reply(200, previous);

      await expect(fetchPrevious('helm', undefined)).resolves.toEqual(previous);
    });
  });

  it('uses the published site by default', () => {
    vi.stubEnv('TOOL_VERSIONS_URL', undefined);

    expect(pagesUrl()).toBe(defaultPagesUrl);
  });

  it('downloads the published file of the versioned path', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', undefined);
    const scope = nock('https://containerbase.github.io')
      .get('/tool-versions/v1/helm.full.json')
      .reply(200, previous);

    await expect(fetchPrevious('helm')).resolves.toEqual(previous);
    expect(scope.isDone()).toBe(true);
  });

  it('accepts a file with a $schema', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const withSchema = {
      $schema: 'https://containerbase.github.io/tool-versions/v1/tool.schema.json',
      ...previous,
    };
    nock('https://fork.example.com').get('/v1/helm.full.json').reply(200, withSchema);

    await expect(fetchPrevious('helm')).resolves.toEqual(withSchema);
  });

  it('downloads from TOOL_VERSIONS_URL', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com/versions');
    const scope = nock('https://fork.example.com')
      .get('/versions/v1/helm.full.json')
      .reply(200, previous);

    await expect(fetchPrevious('helm')).resolves.toEqual(previous);
    expect(scope.isDone()).toBe(true);
  });

  it('accepts a file published without versioning', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const old = {
      ...previous,
      source: { datasource: 'github-releases', packageName: 'helm/helm' },
    };
    nock('https://fork.example.com').get('/v1/helm.full.json').reply(200, old);

    await expect(fetchPrevious('helm')).resolves.toEqual(old);
  });

  it('returns undefined when the full file is missing, without reading other files', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const scope = nock('https://fork.example.com').get('/v1/helm.full.json').reply(404);
    // an unmocked request of the root or the slim file would make nock fail the test scope

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('returns undefined for invalid files', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const invalid = { ...previous, versions: [{ version: '' }] };
    nock('https://fork.example.com').get('/v1/helm.full.json').reply(200, invalid);

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined for responses which are no json', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    nock('https://fork.example.com').get('/v1/helm.full.json').reply(200, '<html></html>');

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined when the download fails', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const scope = nock('https://fork.example.com')
      .get('/v1/helm.full.json')
      .times(3)
      .replyWithError('connection reset');

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('returns undefined on a server error', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const scope = nock('https://fork.example.com').get('/v1/helm.full.json').times(3).reply(503);

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });
});
