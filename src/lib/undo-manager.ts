/**
 * Undo Manager for MediaMaid.
 *
 * Maintains an in-memory stack of reversible file operations so the user
 * can revert the most recent action with a single button press.
 *
 * The stack is also persisted to disk so it survives plugin restarts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { rm, writeFile } from "fs/promises";
import { MAX_UNDO_SNAPSHOTS } from "./config.js";
import { withFsLock } from "./lock.js";
import { moveFile } from "./fs-utils.js";

export interface FileOperation {
  /** Operation type */
  type: "rename" | "move" | "mkdir" | "nfo-write";
  /** Original path of the file/folder */
  from: string;
  /** Destination path of the file/folder */
  to: string;
  /** For nfo-write operations: the original file content to restore on undo */
  previousContent?: string;
}

export interface UndoSnapshot {
  /** Human-readable label for this operation batch */
  label: string;
  /** Timestamp of when the operation was performed */
  timestamp: string;
  /** List of individual file operations (in order they were applied) */
  operations: FileOperation[];
}

const UNDO_FILE_PATH = join(homedir(), ".mediamaid", "undo-stack.json");

function ensureDir(): void {
  const dir = join(homedir(), ".mediamaid");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadStack(): UndoSnapshot[] {
  ensureDir();
  if (!existsSync(UNDO_FILE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(UNDO_FILE_PATH, "utf-8")) as UndoSnapshot[];
  } catch {
    return [];
  }
}

function saveStack(stack: UndoSnapshot[]): void {
  ensureDir();
  // Atomic write: a crash mid-write must never truncate or corrupt the
  // undo history (loadStack() would then silently drop every snapshot).
  // Writing a temp file and renaming it over the target is atomic on
  // every supported platform.
  const tmpPath = `${UNDO_FILE_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(stack, null, 2), "utf-8");
  renameSync(tmpPath, UNDO_FILE_PATH);
}

/**
 * Push a new snapshot onto the undo stack.
 * Older snapshots beyond MAX_UNDO_SNAPSHOTS are discarded.
 */
export function pushUndoSnapshot(snapshot: UndoSnapshot): void {
  const stack = loadStack();
  stack.push(snapshot);
  if (stack.length > MAX_UNDO_SNAPSHOTS) {
    stack.splice(0, stack.length - MAX_UNDO_SNAPSHOTS);
  }
  saveStack(stack);
}

/**
 * Peek at the most recent snapshot without removing it.
 */
export function peekUndoSnapshot(): UndoSnapshot | undefined {
  const stack = loadStack();
  return stack[stack.length - 1];
}

/**
 * Pop the most recent snapshot from the undo stack.
 */
export function popUndoSnapshot(): UndoSnapshot | undefined {
  const stack = loadStack();
  const snapshot = stack.pop();
  saveStack(stack);
  return snapshot;
}

/**
 * Replace the most recent snapshot in place.
 * Used after a partially failed undo: applyUndo() trims the snapshot to
 * the operations that could not be reverted, and that remainder must be
 * persisted so the next Undo press retries only those.
 */
export function replaceTopSnapshot(snapshot: UndoSnapshot): void {
  const stack = loadStack();
  if (stack.length === 0) return;
  stack[stack.length - 1] = snapshot;
  saveStack(stack);
}

/**
 * Revert all file operations in the snapshot (in reverse order).
 * Returns a list of any errors encountered.
 *
 * The snapshot is trimmed down to the operations that could NOT be
 * reverted, so a subsequent Undo press retries only the remaining
 * operations instead of re-processing (and re-failing) the ones that
 * already reverted. Callers must persist that remainder (see
 * replaceTopSnapshot) or pop the snapshot when everything succeeded.
 */
export async function applyUndo(snapshot: UndoSnapshot): Promise<string[]> {
  return withFsLock(() => applyUndoUnlocked(snapshot));
}

/**
 * Unlocked undo implementation — must only be called while already
 * holding the fs lock (directly or via withFsLock).
 */
async function applyUndoUnlocked(snapshot: UndoSnapshot): Promise<string[]> {
  const errors: string[] = [];
  const ops = [...snapshot.operations].reverse();
  const failedOps: FileOperation[] = [];

  for (const op of ops) {
    try {
      if (op.type === "mkdir") {
        // Try to remove the directory (only removes empty dirs for safety)
        try {
          await rm(op.to, { recursive: false });
        } catch {
          // Directory not empty or doesn't exist – skip silently
        }
      } else if (op.type === "nfo-write") {
        // Restore original NFO content, or delete if it was newly created
        if (op.previousContent !== undefined) {
          await writeFile(op.to, op.previousContent, "utf-8");
        } else {
          // File didn't exist before – remove it
          try {
            unlinkSync(op.to);
          } catch {
            // File already gone – skip silently
          }
        }
      } else {
        // rename and move are both reversed by renaming back
        await moveFile(op.to, op.from);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Could not revert "${op.to}" → "${op.from}": ${msg}`);
      failedOps.push(op);
    }
  }

  // Keep the failed operations in their original order.
  snapshot.operations = failedOps.reverse();

  return errors;
}

/**
 * Create a new UndoSnapshot object (not yet pushed – caller must push after success).
 */
export function createSnapshot(label: string, operations: FileOperation[]): UndoSnapshot {
  return { label, timestamp: new Date().toISOString(), operations };
}

/**
 * Return the number of available undo snapshots.
 */
export function undoStackSize(): number {
  return loadStack().length;
}

// Re-export for test use
export { loadStack as _loadStack, saveStack as _saveStack };

