import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultDistro } from '@containerbase/base';
import { z } from 'zod';
import { formats, formatsSchemaUrl, schemaUrl } from './formats.ts';
import { logWarning } from './log.ts';
import { Formats, ToolIndex, ToolVersions, VersionFiles, VersionIntegrity } from './schema.ts';

/** The characters of a version which are safe in a file name. */
const safeVersion = /^[0-9A-Za-z.+_-]+$/;

/** The client files written for a tool, for its `index.json` entry. */
export type ToolFiles = Pick<ToolIndex['tools'][number], 'slim' | 'versionFiles'>;

/**
 * Leaves out the versions which aren't safe in a file name, as the files of a
 * version are published as `<tool>/<version>.json`, with a warning.
 * @param tool - the tool name
 * @param versions - the versions of the tool
 * @returns the safe versions
 */
export function fileNameSafe<T extends { version: string }>(tool: string, versions: T[]): T[] {
  const unsafe = versions.filter(({ version }) => !safeVersion.test(version));
  if (unsafe.length) {
    logWarning(
      `${tool}: leaving out versions which are not safe in a file name: ${unsafe.map(({ version }) => version).join(', ')}`,
    );
  }
  return versions.filter(({ version }) => safeVersion.test(version));
}

/**
 * The SRI-style sha256 digest of some bytes, like npm's `integrity`.
 * @param content - the bytes as written
 */
export function integrity(content: string): string {
  return `sha256-${createHash('sha256').update(content).digest('base64')}`;
}

/**
 * Writes a value as compact json.
 * @param file - the file to write
 * @param value - the value to write
 * @returns the integrity of the written bytes
 */
async function writeJson(file: string, value: unknown): Promise<string> {
  const content = `${JSON.stringify(value)}\n`;
  await writeFile(file, content);
  return integrity(content);
}

/**
 * Validates and writes the files of a tool, all from the same data, as a hash
 * chain: first a `<tool>/<version>.json` with the files of each version which
 * has some, then the `<tool>.integrity.json` with the integrity of each of them,
 * and the slim `<tool>.json` without the files. Versions which aren't safe in a file name are left out with a warning.
 * @param dir - the output folder
 * @param data - the tool versions, with their files
 * @returns the client files with their integrity, for the index
 */
export async function writeToolVersions(dir: string, data: ToolVersions): Promise<ToolFiles> {
  const parsed = ToolVersions.parse(data);
  // the `$schema` is part of the written bytes, so of their integrity
  const full = ToolVersions.parse({
    ...parsed,
    $schema: schemaUrl('tool.schema.json'),
    versions: fileNameSafe(parsed.tool, parsed.versions),
  });
  const folder = join(dir, full.tool);
  // a reused output folder keeps no files of versions which are gone
  await rm(folder, { recursive: true, force: true });

  let versionFiles: ToolFiles['versionFiles'];
  if (full.versions.some(({ files }) => files)) {
    await mkdir(folder, { recursive: true });
    const versions: Record<string, string> = {};
    for (const { version, files } of full.versions) {
      if (files) {
        const entry = VersionFiles.parse({
          $schema: schemaUrl('version.schema.json'),
          tool: full.tool,
          version,
          files,
        });
        versions[version] = await writeJson(join(folder, `${version}.json`), entry);
      }
    }
    const file = `${full.tool}.integrity.json`;
    versionFiles = {
      file,
      integrity: await writeJson(
        join(dir, file),
        VersionIntegrity.parse({
          $schema: schemaUrl('integrity.schema.json'),
          tool: full.tool,
          versions,
        }),
      ),
    };
  }

  const file = `${full.tool}.json`;
  const slim = ToolVersions.parse({
    ...full,
    versions: full.versions.map(({ files: _files, ...version }) => version),
  });
  const slimIntegrity = await writeJson(join(dir, file), slim);
  return {
    slim: { file, integrity: slimIntegrity },
    ...(versionFiles && { versionFiles }),
  };
}

/**
 * Validates and writes the `index.json` file of the format.
 * @param dir - the output folder of the format
 * @param index - the index of all written tools
 */
export async function writeIndex(dir: string, index: ToolIndex): Promise<void> {
  await writeJson(
    join(dir, 'index.json'),
    ToolIndex.parse({ ...index, $schema: schemaUrl('index.schema.json') }),
  );
}

/**
 * Writes the root `index.json`, which lists the published formats and has the
 * default distro of `@containerbase/base`, and its json schema
 * `formats.schema.json`.
 * @param dir - the output folder, the root of the site
 */
export async function writeFormats(dir: string): Promise<void> {
  await writeJson(
    join(dir, 'index.json'),
    Formats.parse({ $schema: formatsSchemaUrl, defaultDistro, formats }),
  );
  await writeJson(join(dir, 'formats.schema.json'), z.toJSONSchema(Formats));
}

/**
 * Writes the json schemas of the `<tool>.json`, `<tool>/<version>.json`, `<tool>.integrity.json` and `index.json` files, as
 * `tool.schema.json`, `version.schema.json`, `integrity.schema.json` and
 * `index.schema.json`.
 * @param dir - the output folder of the format
 */
export async function writeSchemas(dir: string): Promise<void> {
  await writeJson(join(dir, 'tool.schema.json'), z.toJSONSchema(ToolVersions));
  await writeJson(join(dir, 'version.schema.json'), z.toJSONSchema(VersionFiles));
  await writeJson(join(dir, 'integrity.schema.json'), z.toJSONSchema(VersionIntegrity));
  await writeJson(join(dir, 'index.schema.json'), z.toJSONSchema(ToolIndex));
}
