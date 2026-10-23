import * as Base from '@containerbase/base/zod';
import { z } from 'zod';
import { plainSemver } from './versions.ts';

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
  'rust-version',
  'swift-releases',
]);
export type DatasourceName = z.infer<typeof DatasourceName>;

/** The Renovate versioning to compare and match the versions of a tool with. */
export const VersioningName = z.enum([
  'composer',
  'conda',
  'deno',
  'docker',
  'gradle',
  'hashicorp',
  'loose',
  'maven',
  'node',
  'npm',
  'nuget',
  'pep440',
  'pvp',
  'python',
  'ruby',
  'rust-release-channel',
  'semver',
  'semver-coerced',
]);
export type VersioningName = z.infer<typeof VersioningName>;

/** Where the versions of a tool come from, and how to compare them. */
export const Source = z.object({
  datasource: DatasourceName,
  packageName: z.string(),
  versioning: VersioningName,
});
export type Source = z.infer<typeof Source>;

/**
 * The oldest containerbase version which can install the releases from a
 * version of the tool on, in the versioning of the tool. It is configured, and
 * resolved to a published version for the `<tool>.json` files.
 */
export const MinCb = z.object({
  /** the first version of the range, in the versioning of the tool */
  from: z.string(),
  /** the oldest containerbase version, semver */
  cb: z.string(),
});
export type MinCb = z.infer<typeof MinCb>;

/** The source of a tool in the build, with the containerbase versions it needs. */
export const ToolSource = Source.extend({
  /** the ranges of releases which need a newer containerbase, not published in `source` */
  minCb: z.array(MinCb).optional(),
});
export type ToolSource = z.infer<typeof ToolSource>;

/** A file of a version: where to download it and how to verify it. */
export const ToolFile = Base.ToolFile.extend({
  /** the containerbase arch, omitted for arch-independent files */
  arch: Base.Arch.optional(),
});
export type ToolFile = z.infer<typeof ToolFile>;

/** An SRI-style sha256 digest of a published file's bytes, like npm's `integrity`. */
export const Integrity = Base.FileIntegrity;

/**
 * A version `install-tool` can install, the flags are only set when true and
 * `files`, `archs`, `distros`, `releaseTimestamp` and `constraints` only when known.
 */
export const ToolVersion = Base.ToolVersion.extend({
  /**
   * sorted, the archs which have a file of the version, only in the
   * `<tool>.json` files and only for versions with arch-specific files
   */
  archs: z.array(Base.Arch).min(1).optional(),
  /**
   * sorted, the distro codenames which have a file of the version, only in the
   * `<tool>.json` files and only for versions with distro-specific files
   */
  distros: z.array(Base.DistroCode).min(1).optional(),
  /** sorted by name, not in the `<tool>.json` files, but in the `<tool>/<version>.json` ones */
  files: z.array(ToolFile).min(1).optional(),
});
export type ToolVersion = z.infer<typeof ToolVersion>;

/** The content of a `<tool>.json` file. */
export const ToolVersions = Base.ToolVersions.extend({
  /**
   * the containerbase version a release and the releases above it need, newest
   * version first, only for tools with releases which an older containerbase
   * can't install
   */
  minCb: z
    .array(
      z.object({
        /** the oldest listed version of the range, it applies to every version listed above it too */
        version: z.string().min(1),
        /** the oldest containerbase version which can install them, plain semver */
        cb: z.string().regex(plainSemver, 'Invalid semver version'),
      }),
    )
    .min(1)
    .optional(),
  /**
   * build information, deprecated: readers must not rely on it, it is removed
   * with the next format major (#146)
   */
  source: Source.meta({
    deprecated: true,
    description:
      'Deprecated build information, do not use it. It is removed in the next format major.',
  }),
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
export const VersionFiles = Base.VersionFiles.extend({
  /** sorted by name */
  files: z.array(ToolFile).min(1),
});
export type VersionFiles = z.infer<typeof VersionFiles>;

/**
 * The content of a `<tool>.integrity.json` file: the integrity of each
 * `<tool>/<version>.json` file, by version.
 */
export const VersionIntegrity = Base.VersionIntegrity;
export type VersionIntegrity = z.infer<typeof VersionIntegrity>;

/** A published file and the integrity of its bytes. */
export const FileReference = Base.FileReference;
export type FileReference = z.infer<typeof FileReference>;

/** The content of the `index.json` file. */
export const ToolIndex = Base.ToolIndex;
export type ToolIndex = z.infer<typeof ToolIndex>;

/**
 * The content of the root `index.json` file, which lists the published formats.
 * It is minimal and stable: consumers pin a major version of the format and
 * only read it to warn when their major is deprecated.
 */
export const Formats = Base.FormatIndex;
export type Formats = z.infer<typeof Formats>;
