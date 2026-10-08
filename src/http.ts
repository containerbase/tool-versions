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

/**
 * Sends a GET request.
 * @param url - the url to request
 * @param headers - additional request headers
 * @throws {HttpError} on an unsuccessful status code
 */
export async function request(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new HttpError(url, res.status);
  }
  return res;
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
