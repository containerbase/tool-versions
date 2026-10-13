import { ToolType } from '@containerbase/base/zod';
import { z } from 'zod';

/** The upstream sources versions are fetched from. */
export const DatasourceName = z.enum([
  'dart-version',
  'github-releases',
  'gradle-version',
  'hashicorp-releases',
  'haskell-downloads',
  'java-version',
  'node-version',
  'npm',
  'nuget',
  'pypi',
  'rubygems',
]);
export type DatasourceName = z.infer<typeof DatasourceName>;

/** The Renovate versioning to compare and match the versions of a tool with. */
export const VersioningName = z.enum([
  'docker',
  'gradle',
  'maven',
  'node',
  'npm',
  'nuget',
  'pep440',
  'python',
  'ruby',
  'semver',
]);
export type VersioningName = z.infer<typeof VersioningName>;

/** Where the versions of a tool come from, and how to compare them. */
export const Source = z.object({
  datasource: DatasourceName,
  packageName: z.string(),
  versioning: VersioningName,
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

/** An SRI-style sha256 digest of a published file's bytes, like npm's `integrity`. */
export const Integrity = z.string().regex(/^sha256-[0-9A-Za-z+/]{43}=$/);

/**
 * A version `install-tool` can install, the flags are only set when true and
 * `files` and `releaseTimestamp` only when known.
 */
export const ToolVersion = z.object({
  version: z.string().min(1),
  prerelease: z.literal(true).optional(),
  lts: z.literal(true).optional(),
  /** when the version was released, in UTC */
  releaseTimestamp: z.iso.datetime().optional(),
  /** sorted by name, only in `<tool>.full.json` */
  files: z.array(ToolFile).min(1).optional(),
});
export type ToolVersion = z.infer<typeof ToolVersion>;

/** The content of a `<tool>.json` file. */
export const ToolVersions = z.object({
  tool: z.string(),
  /** the package manager installing the tool, omitted for other tools */
  type: ToolType.optional(),
  /** where the source code of the tool lives, omitted when unset */
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  /** the homepage of the tool, omitted when unset */
  homepage: z.url({ protocol: /^https$/ }).optional(),
  source: Source,
  updatedAt: z.iso.datetime(),
  /** newest first */
  versions: z.array(ToolVersion),
});
export type ToolVersions = z.infer<typeof ToolVersions>;

/**
 * A previously published `<tool>.json` file. Files published before the
 * `versioning` was added have none, they still count as previous files.
 */
export const PreviousToolVersions = ToolVersions.extend({
  source: Source.extend({ versioning: VersioningName.optional() }),
});
export type PreviousToolVersions = z.infer<typeof PreviousToolVersions>;

/** The content of a `<tool>/<version>.json` file: the files of one version. */
export const VersionFiles = z.object({
  tool: z.string(),
  version: z.string().min(1),
  /** sorted by name */
  files: z.array(ToolFile).min(1),
});
export type VersionFiles = z.infer<typeof VersionFiles>;

/**
 * The content of a `<tool>.integrity.json` file: the integrity of each
 * `<tool>/<version>.json` file, by version.
 */
export const VersionIntegrity = z.object({
  tool: z.string(),
  versions: z.record(z.string(), Integrity),
});
export type VersionIntegrity = z.infer<typeof VersionIntegrity>;

/** A published file and the integrity of its bytes. */
export const FileReference = z.object({
  file: z.string(),
  integrity: Integrity,
});
export type FileReference = z.infer<typeof FileReference>;

/** The content of the `index.json` file. */
export const ToolIndex = z.object({
  updatedAt: z.iso.datetime(),
  tools: z.array(
    z.object({
      tool: z.string(),
      versionCount: z.number().int().nonnegative(),
      /** the `<tool>.json` file, the versions without their files */
      slim: FileReference,
      /**
       * the `<tool>.integrity.json` file, with the integrity of each
       * `<tool>/<version>.json` file, only for tools with files
       */
      versionFiles: FileReference.optional(),
    }),
  ),
});
export type ToolIndex = z.infer<typeof ToolIndex>;
