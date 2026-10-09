import { z } from 'zod';

/** The upstream sources versions are fetched from. */
export const DatasourceName = z.enum([
  'github-releases',
  'java-version',
  'node-version',
  'npm',
  'pypi',
]);
export type DatasourceName = z.infer<typeof DatasourceName>;

/** Where the versions of a tool come from. */
export const Source = z.object({
  datasource: DatasourceName,
  packageName: z.string(),
});
export type Source = z.infer<typeof Source>;

/** The checksums of release files, as `<algorithm>:<hex>` by file name. */
export const Checksums = z.record(z.string().min(1), z.string().regex(/^sha512:[0-9a-f]+$/));
export type Checksums = z.infer<typeof Checksums>;

/**
 * A version `install-tool` can install, the flags are only set when true and
 * `checksums` only when some are known.
 */
export const ToolVersion = z.object({
  version: z.string().min(1),
  prerelease: z.literal(true).optional(),
  lts: z.literal(true).optional(),
  checksums: Checksums.optional(),
});
export type ToolVersion = z.infer<typeof ToolVersion>;

/** The content of a `<tool>.json` file. */
export const ToolVersions = z.object({
  tool: z.string(),
  source: Source,
  updatedAt: z.iso.datetime(),
  /** newest first */
  versions: z.array(ToolVersion),
});
export type ToolVersions = z.infer<typeof ToolVersions>;

/** The content of the `index.json` file. */
export const ToolIndex = z.object({
  updatedAt: z.iso.datetime(),
  tools: z.array(
    z.object({
      tool: z.string(),
      file: z.string(),
      versionCount: z.number().int().nonnegative(),
    }),
  ),
});
export type ToolIndex = z.infer<typeof ToolIndex>;
