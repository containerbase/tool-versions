import { setTimeout } from 'node:timers/promises';
import type { z } from 'zod';

/** A response with an unsuccessful status code. */
export class HttpError extends Error {
  readonly status: number;

  /**
   * @param url - the requested url
   * @param status - the response status code
   */
  constructor(url: string, status: number) {
    super(`GET ${url} failed with status ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** How often a request is sent before its error is thrown. */
const attempts = 3;

/**
 * Whether a failed request may succeed when sent again: network errors, rate
 * limits and server errors.
 * @param err - the error of the request
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status === 429 || err.status >= 500;
  }
  return err instanceof TypeError;
}

/**
 * Sends a GET request, retrying network errors, rate limits and server errors
 * with a growing delay.
 * @param url - the url to request
 * @param headers - additional request headers
 * @throws {HttpError} on an unsuccessful status code
 */
export async function request(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new HttpError(url, res.status);
      }
      return res;
    } catch (err) {
      if (attempt >= attempts || !isRetryable(err)) {
        throw err;
      }
      await setTimeout(attempt * 1000);
    }
  }
}

/**
 * Fetches a json document and parses it with a schema.
 * @param url - the url to request
 * @param schema - the schema to parse the response with
 * @param headers - additional request headers
 * @throws {HttpError} on an unsuccessful status code
 */
export async function getJson<T extends z.ZodType>(
  url: string,
  schema: T,
  headers?: Record<string, string>,
): Promise<z.output<T>> {
  const res = await request(url, headers);
  return schema.parse(await res.json());
}
