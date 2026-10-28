import type { Formats } from './schema.ts';

/** Where the files are published. */
export const siteUrl = 'https://containerbase.github.io/tool-versions';

/** The folder of the current format in the output folder, and on the site. */
export const formatDir = 'v1';

/**
 * The formats which are published, newest last: a breaking change of the
 * format goes to a new folder while the old one keeps being published for a
 * while, see the README.
 */
export const formats: Formats['formats'] = [
  { version: 1, path: `${formatDir}/`, status: 'current' },
];

/**
 * The absolute url of a json schema of the current format, for the `$schema` of
 * the published files.
 * @param name - the file name of the schema, like `tool.schema.json`
 */
export function schemaUrl(name: string): string {
  return `${siteUrl}/${formatDir}/${name}`;
}

/** The absolute url of the json schema of the root `index.json`. */
export const formatsSchemaUrl = `${siteUrl}/formats.schema.json`;

/** The absolute url of the json schema of the root `release.json`. */
export const releaseSchemaUrl = `${siteUrl}/release.schema.json`;
