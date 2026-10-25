/**
 * Logger for MediaMaid operations.
 *
 * Writes a timestamped log of every rename/move/organize operation to a
 * human-readable log file so the user can review what happened.
 *
 * Entries are buffered in memory and flushed in batches (at the end of a
 * batch operation via flushLog(), after FLUSH_THRESHOLD entries, or at
 * the latest FLUSH_INTERVAL_MS after an entry was written). This avoids
 * one synchronous disk write per file, which stalls the event loop on
 * large folders. The log file is rotated to ".log.1" once it exceeds
 * MAX_LOG_BYTES so it cannot grow without bound.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type OperationType = "rename" | "move" | "mkdir" | "sort" | "write" | "undo" | "dryrun" | "error" | "compress" | "transcode" | "checksum" | "verify";

export interface LogEntry {
  timestamp: string;
  operation: OperationType;
  from?: string;
  to?: string;
  message: string;
}

const LOG_DIR = join(homedir(), ".mediamaid");
const LOG_PATH = join(LOG_DIR, "mediamaid.log");
/** Rotate the log once it exceeds 5 MB (kept as one previous generation). */
const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** Flush the buffer as soon as it holds this many entries. */
const FLUSH_THRESHOLD = 200;
/** Latest: flush pending entries this long after they were buffered. */
const FLUSH_INTERVAL_MS = 1000;

let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function getLogPath(): string {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  return LOG_PATH;
}

function formatEntry(entry: LogEntry): string {
  const parts = [`[${entry.timestamp}] [${entry.operation.toUpperCase()}]`];
  if (entry.from) parts.push(`FROM: "${entry.from}"`);
  if (entry.to) parts.push(`TO:   "${entry.to}"`);
  if (entry.message) parts.push(`MSG:  ${entry.message}`);
  return parts.join("\n  ") + "\n";
}

/**
 * Rename the current log to ".log.1" once it grows past MAX_LOG_BYTES.
 * Best-effort; never fails an operation because of it.
 */
function rotateIfNeeded(): void {
  try {
    const logPath = getLogPath();
    if (!existsSync(logPath)) return;
    if (statSync(logPath).size < MAX_LOG_BYTES) return;
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // Rotation is best-effort; never fail an operation for it.
  }
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  const timer = setTimeout(() => {
    flushTimer = undefined;
    flushLog();
  }, FLUSH_INTERVAL_MS);
  // Never keep the process alive just for a pending flush (tests, shutdown).
  (timer as unknown as { unref?: () => void }).unref?.();
  flushTimer = timer;
}

/**
 * Write all buffered log entries to the log file in a single append.
 * Runs automatically on the timer/threshold; batch operations also call
 * it directly so their log is on disk as soon as they finish.
 */
export function flushLog(): void {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    appendFileSync(getLogPath(), batch.join(""), "utf-8");
    rotateIfNeeded();
  } catch {
    // Silently fail – logging should never crash the plugin
  }
}

/**
 * Write a log entry to the MediaMaid log file.
 * The entry is buffered and flushed in batches to avoid one synchronous
 * disk write per file during large operations.
 */
export function logOperation(entry: Omit<LogEntry, "timestamp">): void {
  const full: LogEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  pending.push(formatEntry(full) + "\n");
  if (pending.length >= FLUSH_THRESHOLD) {
    flushLog();
  } else {
    scheduleFlush();
  }
}

/**
 * Return the path to the log file.
 */
export function getLogFilePath(): string {
  return getLogPath();
}
