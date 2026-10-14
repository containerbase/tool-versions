import { env } from 'node:process';
import { formatDir, siteUrl } from './formats.ts';
import { request } from './http.ts';
import { PreviousToolVersions } from './schema.ts';

/** Where the files are published. */
export const defaultPagesUrl = siteUrl;

/** The published site, `TOOL_VERSIONS_URL` overrides it, e.g. for a fork. */
export function pagesUrl(): string {
  return env['TOOL_VERSIONS_URL'] ?? defaultPagesUrl;
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
    const res = await request(`${pagesUrl()}/${formatDir}/${tool}.full.json`);
    const parsed = PreviousToolVersions.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
