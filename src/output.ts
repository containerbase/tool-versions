import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { ToolIndex, ToolVersions } from './schema.ts';

/**
 * Writes a value as formatted json, and a `<file>.sha512` file next to it with
 * the digest of the written bytes, like `sha512sum` prints it.
 * @param file - the file to write
 * @param value - the value to write
 */
async function writeJson(file: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(file, content);
  const digest = createHash('sha512').update(content).digest('hex');
  await writeFile(`${file}.sha512`, `${digest}  ${basename(file)}\n`);
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
