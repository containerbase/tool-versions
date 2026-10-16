import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatDir } from './formats.ts';
import { PreviousToolVersions, VersionFiles } from './schema.ts';

/**
 * Reads a json file and validates it.
 * @param file - the file
 * @param schema - the schema of the content
 * @returns the content, or `undefined` when the file is missing or invalid
 */
async function readJson<T>(
  file: string,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
): Promise<T | undefined> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rebuilds the previous data of a tool from the extracted archive of a release:
 * the slim `<tool>.json` with the `files` of each version from its
 * `<tool>/<version>.json`.
 * @param dir - the folder with the extracted archive
 * @param tool - the tool name
 * @returns the data, or `undefined` when the archive has no valid file of the tool
 */
export async function readArchivePrevious(
  dir: string,
  tool: string,
): Promise<PreviousToolVersions | undefined> {
  const folder = join(dir, formatDir);
  const slim = await readJson(join(folder, `${tool}.json`), PreviousToolVersions);
  if (!slim) {
    return undefined;
  }
  const versions = await Promise.all(
    slim.versions.map(async (entry) => {
      const files = await readJson(join(folder, tool, `${entry.version}.json`), VersionFiles);
      return files ? { ...entry, files: files.files } : entry;
    }),
  );
  return { ...slim, versions };
}
