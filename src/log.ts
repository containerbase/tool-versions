import { stdout } from 'node:process';

/** The level of a log entry, as GitHub Actions names its annotations. */
export type LogLevel = 'notice' | 'warning' | 'error';

/** A line of the build log. */
export interface LogEntry {
  level: LogLevel;
  message: string;
}

/** Where the entries are collected too, while a tool is built. */
let collector: LogEntry[] | undefined;

/**
 * Collects the log entries into a list, for the job summary, until it is
 * called with `undefined`. The lines are written to stdout in any case.
 * @param entries - the list to add the entries to
 */
export function collectLogs(entries: LogEntry[] | undefined): void {
  collector = entries;
}

/**
 * Writes a GitHub Actions annotation line and collects the entry.
 * @param level - the level of the annotation
 * @param message - the message
 */
function log(level: LogLevel, message: string): void {
  stdout.write(`::${level}::${message}\n`);
  collector?.push({ level, message });
}

/**
 * Logs a notice, something to know which is no problem.
 * @param message - the message
 */
export function logNotice(message: string): void {
  log('notice', message);
}

/**
 * Logs a warning, something which is skipped or retried.
 * @param message - the message
 */
export function logWarning(message: string): void {
  log('warning', message);
}

/**
 * Logs an error, a tool which couldn't be built.
 * @param message - the message
 */
export function logError(message: string): void {
  log('error', message);
}
