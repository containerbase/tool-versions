import { z } from 'zod';
import { getJson } from '../http.ts';
import type { ToolVersion } from '../schema.ts';
import {
  compareRuby,
  isRubyVersion,
  sortVersions,
  toConstraints,
  toTimestamp,
  toolVersion,
} from '../versions.ts';

const RubygemsVersions = z.array(
  z.object({
    number: z.string(),
    prerelease: z.boolean(),
    created_at: z.string().optional(),
    ruby_version: z.string().nullish(),
  }),
);

/**
 * Fetches all versions of a gem from rubygems.org, like the containerbase gem
 * resolver. The prerelease flag, the release time and the `ruby_version`, the
 * `ruby` constraint without the `>= 0` of gems which accept any ruby, come
 * from the same document. Versions which are no valid ruby version are skipped.
 * @param packageName - the gem name
 */
export async function fetchRubygemsVersions(packageName: string): Promise<ToolVersion[]> {
  const releases = await getJson(
    `https://rubygems.org/api/v1/versions/${encodeURIComponent(packageName)}.json`,
    RubygemsVersions,
  );
  const versions = releases
    .filter(({ number }) => isRubyVersion(number))
    .map(({ number, prerelease, created_at, ruby_version }) =>
      toolVersion(number, {
        prerelease,
        releaseTimestamp: toTimestamp(created_at),
        constraints: toConstraints('ruby', ruby_version, '>= 0'),
      }),
    );
  return sortVersions(versions, compareRuby);
}
