import * as Base from '@containerbase/base/zod';
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
  'rust-version',
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
  'rust-release-channel',
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
export const ToolFile = Base.ToolFile.extend({
  /** the containerbase arch, omitted for arch-independent files */
  arch: z.enum(['amd64', 'arm64']).optional(),
});
export type ToolFile = z.infer<typeof ToolFile>;

/** An SRI-style sha256 digest of a published file's bytes, like npm's `integrity`. */
export const Integrity = Base.FileIntegrity;

/**
 * A version `install-tool` can install, the flags are only set when true and
 * `files`, `releaseTimestamp` and `constraints` only when known.
 */
export const ToolVersion = Base.ToolVersion.extend({
  /** sorted by name, not in the `<tool>.json` files, but in the `<tool>/<version>.json` ones */
  files: z.array(ToolFile).min(1).optional(),
});
export type ToolVersion = z.infer<typeof ToolVersion>;

/** The content of a `<tool>.json` file. */
export const ToolVersions = Base.ToolVersions.extend({
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
