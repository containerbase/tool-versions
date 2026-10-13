import { env } from 'node:process';
import { HttpError, request } from './http.ts';
import { PreviousToolVersions } from './schema.ts';

/** Where the files are published. */
export const defaultPagesUrl = 'https://containerbase.github.io/tool-versions';

/** The published site, `TOOL_VERSIONS_URL` overrides it, e.g. for a fork. */
export function pagesUrl(): string {
  return env['TOOL_VERSIONS_URL'] ?? defaultPagesUrl;
}

/**
 * Downloads and validates a published tool file.
 * @param file - the file name
 * @returns the file, `'missing'` when it doesn't exist (404), or `undefined`
 * when it can't be downloaded or is invalid
 */
async function download(file: string): Promise<PreviousToolVersions | 'missing' | undefined> {
  try {
    const res = await request(`${pagesUrl()}/${file}`);
    const parsed = PreviousToolVersions.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch (err) {
    return err instanceof HttpError && err.status === 404 ? 'missing' : undefined;
  }
}

/**
 * Downloads the previously published file of a tool, the `<tool>.full.json`
 * with the files of the versions.
 * @param tool - the tool name
 * @returns the file, or `undefined` when it is missing, can't be downloaded or
 * is invalid
 */
export async function fetchPrevious(tool: string): Promise<PreviousToolVersions | undefined> {
  const full = await download(`${tool}.full.json`);
  if (full !== 'missing') {
    return full;
  }
  // only a missing full file falls back to `<tool>.json`, and only when it
  // still has the files of the old layout, or the tool is installed by a
  // package manager and has none; a slim file of the new layout would replace
  // the known files with none. The fallback can go once a build with the new
  // layout has been published.
  const old = await download(`${tool}.json`);
  return old && old !== 'missing' && (old.type || old.versions.some(({ files }) => files))
    ? old
    : undefined;
}
