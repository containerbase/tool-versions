import { env } from 'node:process';
import { formatDir, siteUrl } from './formats.ts';
import { HttpError, request } from './http.ts';
import { PreviousToolVersions } from './schema.ts';

/** Where the files are published. */
export const defaultPagesUrl = siteUrl;

/** The published site, `TOOL_VERSIONS_URL` overrides it, e.g. for a fork. */
export function pagesUrl(): string {
  return env['TOOL_VERSIONS_URL'] ?? defaultPagesUrl;
}

/**
 * Downloads and validates a published full file.
 * @param path - the path of the file on the site
 * @returns the file, or `undefined` when it is invalid
 * @throws when it can't be downloaded, with an `HttpError` for a missing file
 */
async function download(path: string): Promise<PreviousToolVersions | undefined> {
  const res = await request(`${pagesUrl()}/${path}`);
  const parsed = PreviousToolVersions.safeParse(await res.json());
  return parsed.success ? parsed.data : undefined;
}

/**
 * Downloads the previously published file of a tool, the `<tool>.full.json`
 * of the current format with the files of the versions.
 * @param tool - the tool name
 * @returns the file, or `undefined` when it is missing, can't be downloaded or
 * is invalid
 */
export async function fetchPrevious(tool: string): Promise<PreviousToolVersions | undefined> {
  try {
    return await download(`${formatDir}/${tool}.full.json`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      // the files were published in the root before the versioned path, so the
      // first build of the versioned path reuses their files instead of
      // downloading them again: this can go once a build with it is published
      try {
        return await download(`${tool}.full.json`);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
