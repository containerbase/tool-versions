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
      .get('/tool-versions/helm.json')
      .reply(200, previous);

    await expect(fetchPrevious('helm')).resolves.toEqual(previous);
    expect(scope.isDone()).toBe(true);
  });

  it('downloads from TOOL_VERSIONS_URL', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com/versions');
    const scope = nock('https://fork.example.com').get('/versions/helm.json').reply(200, previous);

    await expect(fetchPrevious('helm')).resolves.toEqual(previous);
    expect(scope.isDone()).toBe(true);
  });

  it('accepts a file published without versioning', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    const old = {
      ...previous,
      source: { datasource: 'github-releases', packageName: 'helm/helm' },
    };
    nock('https://fork.example.com').get('/helm.json').reply(200, old);

    await expect(fetchPrevious('helm')).resolves.toEqual(old);
  });

  it('returns undefined for a missing file', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    nock('https://fork.example.com').get('/helm.json').reply(404);

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined for an invalid file', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    nock('https://fork.example.com')
      .get('/helm.json')
      .reply(200, { ...previous, versions: [{ version: '' }] });

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined for a response which is no json', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    nock('https://fork.example.com').get('/helm.json').reply(200, '<html></html>');

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });

  it('returns undefined when the download fails', async () => {
    vi.stubEnv('TOOL_VERSIONS_URL', 'https://fork.example.com');
    nock('https://fork.example.com').get('/helm.json').replyWithError('connection reset');

    await expect(fetchPrevious('helm')).resolves.toBeUndefined();
  });
});
