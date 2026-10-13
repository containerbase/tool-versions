import { createHash } from 'node:crypto';
import { env, stdout } from 'node:process';
import { HttpError, request } from './http.ts';
import type { ToolFile } from './schema.ts';

/** The default download budget of a build, in bytes. */
const defaultBudget = 3 * 1024 ** 3;

/** The bytes which no tool has been given as its share yet. */
let unassigned = budgetFromEnv();

/** The number of tools which may compute files and haven't had their turn yet. */
let waiting = 0;

/** The bytes the tool whose turn it is can still download. */
let remaining = unassigned;

/** The number of files per label which were skipped as the budget was used up. */
const skipped = new Map<string, number>();

/**
 * Reads the download budget from `TOOL_VERSIONS_DOWNLOAD_BUDGET`, in bytes.
 * @returns the budget, the default for a missing or invalid value
 */
function budgetFromEnv(): number {
  const value = Number(env['TOOL_VERSIONS_DOWNLOAD_BUDGET']);
  return env['TOOL_VERSIONS_DOWNLOAD_BUDGET'] && Number.isFinite(value) && value >= 0
    ? value
    : defaultBudget;
}

/**
 * Starts a build with the full download budget again, and forgets the skipped
 * files. The budget is split fairly between the tools which may compute files:
 * each gets its share when its turn comes, see `startToolDownloads`. Without a
 * count, all downloads share the whole budget.
 * @param tools - how many tools may compute files in this build
 */
export function resetDownloadBudget(tools = 0): void {
  unassigned = budgetFromEnv();
  waiting = tools;
  remaining = tools > 0 ? 0 : unassigned;
  skipped.clear();
}

/**
 * Starts the turn of a tool. A tool which may compute files gets an equal share
 * of the budget which is left, so a tool which needs less leaves the rest to
 * the tools after it, and one big tool can't use the budget of the others.
 * @param computes - whether the tool may compute files
 */
export function startToolDownloads(computes: boolean): void {
  remaining = 0;
  if (computes && waiting > 0) {
    const share = unassigned / waiting;
    unassigned -= share;
    waiting--;
    remaining = share;
  }
}

/** Ends the turn of a tool, the unused part of its share goes to the next tools. */
export function finishToolDownloads(): void {
  unassigned += remaining;
  remaining = 0;
}

/** The bytes the current tool can still download. */
export function remainingDownloadBudget(): number {
  return remaining;
}

/**
 * Prints one line for a tool whose checksums weren't all computed because the
 * budget was used up. The next build continues, newest versions first.
 * @param label - names the tool or package
 */
export function reportSkippedDownloads(label: string): void {
  const count = skipped.get(label);
  if (count) {
    stdout.write(
      `::notice::${label}: download budget of the tool used up, the checksums of ${count} files will be computed by the next builds\n`,
    );
    skipped.delete(label);
  }
}

/**
 * Counts a file which was skipped as the download budget is used up.
 * @param label - names the tool or package
 */
function skipFile(label: string): void {
  skipped.set(label, (skipped.get(label) ?? 0) + 1);
}

/**
 * Downloads a file as a stream and hashes it, without keeping it in memory.
 * The size is taken from the `content-length` before the body is read, so a big
 * file doesn't overrun the budget; without one the budget is checked while
 * streaming. A file which doesn't fit is not downloaded.
 * @param url - the file to download
 * @returns the `sha256:<hex>` checksum, or `undefined` when the budget is used up
 * @throws on an unsuccessful status or a failed download
 */
export async function computeChecksum(url: string): Promise<string | undefined> {
  if (remaining <= 0) {
    return undefined;
  }
  const res = await request(url);
  const body = res.body;
  const length = Number(res.headers.get('content-length'));
  const known = Number.isFinite(length) && length > 0;
  if (!body || (known && length > remaining)) {
    await body?.cancel();
    return undefined;
  }
  if (known) {
    remaining -= length;
  }
  const hash = createHash('sha256');
  for await (const chunk of body) {
    if (!known) {
      remaining -= chunk.byteLength;
      if (remaining < 0) {
        // leaving the loop cancels the stream
        return undefined;
      }
    }
    hash.update(chunk);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** A file whose checksum is computed. */
export interface ComputedFile {
  name: string;
  url: string;
  arch?: ToolFile['arch'];
  distro?: ToolFile['distro'];
}

/**
 * Creates the tasks which compute the checksums of files which have no
 * published one, by downloading them. Files which are known already aren't
 * downloaded again. A failed download skips the file with a warning, the next
 * build tries again, a missing file (404) is skipped silently. When the budget is used up the files are skipped, see
 * `reportSkippedDownloads`.
 * @param label - names the tool or package in warnings
 * @param candidates - the files of a version, newest version first across calls
 * @param files - the known files of the version, the downloads add to it
 */
export function computeChecksumTasks(
  label: string,
  candidates: ComputedFile[],
  files: ToolFile[],
): (() => Promise<void>)[] {
  return candidates
    .filter(({ name }) => !files.some((file) => file.name === name))
    .map(({ name, url, arch, distro }) => async () => {
      try {
        const sum = await computeChecksum(url);
        if (!sum) {
          skipFile(label);
          return;
        }
        files.push({ name, url, checksum: sum, ...(arch && { arch }), ...(distro && { distro }) });
      } catch (err) {
        // a file which doesn't exist upstream is no problem, other failures are
        if (!(err instanceof HttpError && err.status === 404)) {
          stdout.write(`::warning::${label}: no checksum computed for ${url}: ${String(err)}\n`);
        }
      }
    });
}
