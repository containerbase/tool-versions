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

/** A file of a version: where to download it and how to verify it. */
export const ToolFile = z.object({
  /** the file name */
  name: z.string().min(1),
  /** the https download url */
  url: z.url({ protocol: /^https$/ }),
  /** `<algorithm>:<lowercase hex>` */
  checksum: z.string().regex(/^(sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})$/),
  /** the containerbase arch, omitted for arch-independent files */
  arch: z.enum(['amd64', 'arm64']).optional(),
  /** the distro of a distro specific file, like `jammy` */
  distro: z.string().min(1).optional(),
});
export type ToolFile = z.infer<typeof ToolFile>;

/**
 * A version `install-tool` can install, the flags are only set when true and
 * `files` only when some are known.
 */
export const ToolVersion = z.object({
  version: z.string().min(1),
  prerelease: z.literal(true).optional(),
  lts: z.literal(true).optional(),
  /** sorted by name */
  files: z.array(ToolFile).min(1).optional(),
});
export type ToolVersion = z.infer<typeof ToolVersion>;

/** The content of a `<tool>.json` file. */
export const ToolVersions = z.object({
  tool: z.string(),
  /** the package manager installing the tool, omitted for other tools */
  type: z.enum(['gem', 'npm', 'pip']).optional(),
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
