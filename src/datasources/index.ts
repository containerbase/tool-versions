import { compare as comparePep440 } from '@renovatebot/pep440';
import type { Checksums, DatasourceName, ToolVersion } from '../schema.ts';
import { compareSemver } from '../versions.ts';
import { fetchGithubReleases } from './github-releases.ts';
import { fetchJavaVersions } from './java-version.ts';
import { fetchNodeVersions } from './node-version.ts';
import { fetchNpmVersions } from './npm.ts';
import { fetchPypiVersions } from './pypi.ts';

/**
 * Fetches the versions of a package, newest first. Paged sources may stop
 * early once they reach a known version. Sources with checksums reuse the
 * previously published ones instead of downloading them again.
 */
export type Fetcher = (
  packageName: string,
  known: ReadonlySet<string>,
  checksums?: ReadonlyMap<string, Checksums>,
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
