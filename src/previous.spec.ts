import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPagesUrl, fetchPrevious, pagesUrl } from './previous.ts';
import type { ToolVersions } from './schema.ts';

const previous: ToolVersions = {
  tool: 'helm',
  source: { datasource: 'github-releases', packageName: 'helm/helm', versioning: 'semver' },
  updatedAt: '2026-10-07T03:00:00.000Z',
  versions: [{ version: '4.0.0' }],
};

describe('previous', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.unstubAllEnvs();
  });

  it('uses the published site by default', () => {
    vi.stubEnv('TOOL_VERSIONS_URL', undefined);

    expect(pagesUrl()).toBe(defaultPagesUrl);
  });

  it('downloads the published file', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', undefined);
    const scope = nock('https://containerbase.github.io')
      .get('/tool-versions/helm.full.json')
      .reply(200, previous);

    await expect(fetchPrevious('helm')).resolves.toEqual(previous);
    expect(scope.isDone()).toBe(true);
  });

  it('downloads from TOOL_VERSIONS_URL', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com/versions');
    const scope = nock('https://fork.example.com')
      .get('/versions/helm.full.json')
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
    nock('https://fork.example.com').get('/helm.full.json').reply(200, old);

    await expect(fetchPrevious('helm')).resolves.toEqual(old);
  });

  it('returns undefined when the full file is missing, without reading the slim file', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const scope = nock('https://fork.example.com').get('/helm.full.json').reply(404);
    // an unmocked request of `/helm.json` would make nock fail the test scope

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('returns undefined for invalid files', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const invalid = { ...previous, versions: [{ version: '' }] };
    nock('https://fork.example.com').get('/helm.full.json').reply(200, invalid);

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined for responses which are no json', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    nock('https://fork.example.com').get('/helm.full.json').reply(200, '<html></html>');

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined when the download fails', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const scope = nock('https://fork.example.com')
      .get('/helm.full.json')
      .times(3)
      .replyWithError('connection reset');

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });

  it('returns undefined on a server error', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const scope = nock('https://fork.example.com').get('/helm.full.json').times(3).reply(503);

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
    expect(scope.isDone()).toBe(true);
  });
});
