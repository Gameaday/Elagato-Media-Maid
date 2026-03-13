/**
 * Logger for MediaMaid operations.
 *
 * Writes a timestamped log of every rename/move/organize operation to a
 * human-readable log file so the user can review what happened.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type OperationType = "rename" | "move" | "mkdir" | "sort" | "undo" | "dryrun" | "error";

export interface LogEntry {
  timestamp: string;
  operation: OperationType;
  from?: string;
  to?: string;
  message: string;
}

function getLogPath(): string {
  const logDir = join(homedir(), ".mediamaid");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return join(logDir, "mediamaid.log");
}

function formatEntry(entry: LogEntry): string {
  const parts = [`[${entry.timestamp}] [${entry.operation.toUpperCase()}]`];
  if (entry.from) parts.push(`FROM: "${entry.from}"`);
  if (entry.to) parts.push(`TO:   "${entry.to}"`);
  if (entry.message) parts.push(`MSG:  ${entry.message}`);
  return parts.join("\n  ") + "\n";
}

/**
 * Write a log entry to the MediaMaid log file.
 */
export function logOperation(entry: Omit<LogEntry, "timestamp">): void {
  const full: LogEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  try {
    appendFileSync(getLogPath(), formatEntry(full) + "\n", "utf-8");
  } catch {
    // Silently fail – logging should never crash the plugin
  }
}

/**
 * Return the path to the log file.
 */
export function getLogFilePath(): string {
  return getLogPath();
}
