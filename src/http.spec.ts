import nock from 'nock';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, request } from './http.ts';

const host = 'https://example.com';

describe('http', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('request', () => {
    it('retries server errors and rate limits', async () => {
      nock(host).get('/a').reply(503).get('/a').reply(429).get('/a').reply(200, 'ok');

      const res = await request(`${host}/a`);
      await expect(res.text()).resolves.toBe('ok');
    });

    it('retries network errors', async () => {
      nock(host).get('/a').replyWithError('connection reset').get('/a').reply(200, 'ok');

      const res = await request(`${host}/a`);
      await expect(res.text()).resolves.toBe('ok');
    });

    it('gives up after three attempts', async () => {
      nock(host).get('/a').times(3).reply(504);

      await expect(request(`${host}/a`)).rejects.toThrow(new HttpError(`${host}/a`, 504));
      expect(nock.isDone()).toBe(true);
    });

    it('does not retry client errors', async () => {
      nock(host).get('/a').reply(404);

      await expect(request(`${host}/a`)).rejects.toThrow(new HttpError(`${host}/a`, 404));
    });
  });
});
