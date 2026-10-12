import type { PreviousFiles, ToolFiles } from '../files.ts';
import type { DatasourceName, ToolVersion, VersioningName } from '../schema.ts';
import { fetchGithubReleases } from './github-releases.ts';
import { fetchGradleVersions } from './gradle-version.ts';
import { fetchHashicorpReleases } from './hashicorp-releases.ts';
import { fetchJavaVersions } from './java-version.ts';
import { fetchNodeVersions } from './node-version.ts';
import { fetchNpmVersions } from './npm.ts';
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
  'github-releases': fetchGithubReleases,
  'gradle-version': fetchGradleVersions,
  'hashicorp-releases': fetchHashicorpReleases,
  'java-version': fetchJavaVersions,
  'node-version': fetchNodeVersions,
  npm: fetchNpmVersions,
  nuget: fetchNugetVersions,
  pypi: fetchPypiVersions,
  rubygems: fetchRubygemsVersions,
};
