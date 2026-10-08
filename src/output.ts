import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ToolIndex, ToolVersions } from './schema.ts';

/**
 * Writes a value as formatted json.
 * @param file - the file to write
 * @param value - the value to write
 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Validates and writes the `<tool>.json` file of a tool.
 * @param dir - the output folder
 * @param data - the tool versions
 * @returns the file name
 */
export async function writeToolVersions(dir: string, data: ToolVersions): Promise<string> {
  const file = `${data.tool}.json`;
  await writeJson(join(dir, file), ToolVersions.parse(data));
  return file;
}

/**
 * Validates and writes the `index.json` file.
 * @param dir - the output folder
 * @param index - the index of all written tools
 */
export async function writeIndex(dir: string, index: ToolIndex): Promise<void> {
  await writeJson(join(dir, 'index.json'), ToolIndex.parse(index));
}

/**
 * Writes the json schemas of the `<tool>.json` and `index.json` files, as
 * `tool.schema.json` and `index.schema.json`.
 * @param dir - the output folder
 */
export async function writeSchemas(dir: string): Promise<void> {
  await writeJson(join(dir, 'tool.schema.json'), z.toJSONSchema(ToolVersions));
  await writeJson(join(dir, 'index.schema.json'), z.toJSONSchema(ToolIndex));
}
