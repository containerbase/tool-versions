import { ToolType } from '@containerbase/base/zod';
import { z } from 'zod';

/** The upstream sources versions are fetched from. */
export const DatasourceName = z.enum([
  'android-sdk',
  'dart-version',
  'dotnet-version',
  'github-releases',
  'gradle-version',
  'hashicorp-releases',
  'haskell-downloads',
  'java-version',
  'node-version',
  'npm',
  'nuget',
  'nuget-exe',
  'pypi',
  'rubygems',
  'swift-releases',
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
  checksum: z.string().regex(/^(sha1:[0-9a-f]{40}|sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})$/),
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
  /** sorted by name, not in the `<tool>.json` files, but in the `<tool>/<version>.json` ones */
  files: z.array(ToolFile).min(1).optional(),
});
export type ToolVersion = z.infer<typeof ToolVersion>;

/**
 * The url of the json schema of a published file, which identifies its format.
 * It is the first property, optional so files published before it was added
 * still parse.
 */
const SchemaUrl = z.url({ protocol: /^https$/ }).optional();

/** The content of a `<tool>.json` file. */
export const ToolVersions = z.object({
  $schema: SchemaUrl,
  tool: z.string(),
  /** the package manager installing the tool, omitted for other tools */
  type: ToolType.optional(),
  /** where the source code of the tool lives, omitted when unset */
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  /** the homepage of the tool, omitted when unset */
  homepage: z.url({ protocol: /^https$/ }).optional(),
  /**
   * the oldest version containerbase supports, on the `defaultDistro` of the
   * root index, in the versioning of the tool. Older versions aren't listed.
   * Omitted for tools without a limit.
   */
  minVersion: z.string().min(1).optional(),
  /**
   * the oldest version on a distro, by codename, only for the distros whose
   * floor differs from `minVersion`. Any codename is allowed, so new distros
   * don't break readers.
   */
  distroMinVersion: z.record(z.string().min(1), z.string().min(1)).optional(),
  /**
   * build information, deprecated: readers must not rely on it, it is removed
   * with the next format major (#146)
   */
  source: Source.meta({
    deprecated: true,
    description:
      'Deprecated build information, do not use it. It is removed in the next format major.',
  }),
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
  $schema: SchemaUrl,
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
  $schema: SchemaUrl,
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
  $schema: SchemaUrl,
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

/**
 * The content of the root `index.json` file, which lists the published formats.
 * It is minimal and stable: consumers pin a major version of the format and
 * only read it to warn when their major is deprecated.
 */
export const Formats = z.object({
  $schema: SchemaUrl,
  /**
   * the codename of the Ubuntu release the default image is built from, which
   * the `minVersion` of the tools refers to
   */
  defaultDistro: z.string().min(1),
  formats: z.array(
    z.object({
      /** the major version of the format */
      version: z.number().int().positive(),
      /** the folder of the format, relative to the root */
      path: z.string().min(1),
      /** `current` is the format to use, `preview` is not stable yet */
      status: z.enum(['current', 'preview', 'deprecated']),
      /** the date a deprecated format is no longer published */
      removalDate: z.iso.date().optional(),
    }),
  ),
});
export type Formats = z.infer<typeof Formats>;
