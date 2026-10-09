import { compare as comparePep440 } from '@renovatebot/pep440';
import type { FileTemplate, PreviousFiles } from '../files.ts';
import type { DatasourceName, ToolVersion } from '../schema.ts';
import { compareSemver } from '../versions.ts';
import { fetchGithubReleases } from './github-releases.ts';
import { fetchJavaVersions } from './java-version.ts';
import { fetchNodeVersions } from './node-version.ts';
import { fetchNpmVersions } from './npm.ts';
import { fetchPypiVersions } from './pypi.ts';

/**
 * Fetches the versions of a package, newest first. Paged sources may stop
 * early once they reach a known version. The previously published files are
 * reused by name instead of fetching them again. A template lists the files of
 * a version where the source doesn't. No files are fetched when `fetchFiles`
 * is `false`. Sources which need a request for the release time of a version
 * skip it for the versions in `hasTimestamp`, which already have one.
 */
export type Fetcher = (
  packageName: string,
  known: ReadonlySet<string>,
  previous?: PreviousFiles,
  template?: FileTemplate,
  fetchFiles?: boolean,
  hasTimestamp?: ReadonlySet<string>,
) => Promise<ToolVersion[]>;

/** A datasource: how its versions are fetched and compared. */
export interface Datasource {
  fetch: Fetcher;
  /** compares two versions, negative when the first is older */
  compare: (a: string, b: string) => number;
}

/** Each datasource. */
export const datasources: Record<DatasourceName, Datasource> = {
  'github-releases': { fetch: fetchGithubReleases, compare: compareSemver },
  'java-version': { fetch: fetchJavaVersions, compare: compareSemver },
  'node-version': { fetch: fetchNodeVersions, compare: compareSemver },
  npm: { fetch: fetchNpmVersions, compare: compareSemver },
  pypi: { fetch: fetchPypiVersions, compare: comparePep440 },
};
