import type { PreviousFiles, ToolFiles } from '../files.ts';
import type { DatasourceName, ToolVersion, VersioningName } from '../schema.ts';
import { fetchAndroidSdkVersions } from './android-sdk.ts';
import { fetchDartVersions } from './dart-version.ts';
import { fetchGithubReleases } from './github-releases.ts';
import { fetchGradleVersions } from './gradle-version.ts';
import { fetchHashicorpReleases } from './hashicorp-releases.ts';
import { fetchHaskellDownloads } from './haskell-downloads.ts';
import { fetchJavaVersions } from './java-version.ts';
import { fetchNodeVersions } from './node-version.ts';
import { fetchNpmVersions } from './npm.ts';
import { fetchNugetExeVersions } from './nuget-exe.ts';
import { fetchNugetVersions } from './nuget.ts';
import { fetchPypiVersions } from './pypi.ts';
import { fetchRubygemsVersions } from './rubygems.ts';

/**
 * Fetches the versions of a package, newest first. Paged sources may stop
 * early once they reach a known version. The previously published files are
 * reused by name instead of fetching them again. A template lists the files of
 * a version where the source doesn't. No files are fetched when `fetchFiles`
 * is `false`. Sources which need a request for the release time of a version
 * skip it for the versions in `hasTimestamp`, which already have one. Sources
 * which list arbitrary tags validate and sort them with the `versioning`.
 */
export type Fetcher = (
  packageName: string,
  known: ReadonlySet<string>,
  previous?: PreviousFiles,
  template?: ToolFiles,
  fetchFiles?: boolean,
  hasTimestamp?: ReadonlySet<string>,
  versioning?: VersioningName,
) => Promise<ToolVersion[]>;

/** The fetcher of each datasource. */
export const datasources: Record<DatasourceName, Fetcher> = {
  'android-sdk': fetchAndroidSdkVersions,
  'dart-version': fetchDartVersions,
  'github-releases': fetchGithubReleases,
  'gradle-version': fetchGradleVersions,
  'hashicorp-releases': fetchHashicorpReleases,
  'haskell-downloads': fetchHaskellDownloads,
  'java-version': fetchJavaVersions,
  'node-version': fetchNodeVersions,
  npm: fetchNpmVersions,
  nuget: fetchNugetVersions,
  'nuget-exe': fetchNugetExeVersions,
  pypi: fetchPypiVersions,
  rubygems: fetchRubygemsVersions,
};
