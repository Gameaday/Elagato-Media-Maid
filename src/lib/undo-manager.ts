/**
 * Undo Manager for MediaMaid.
 *
 * Maintains an in-memory stack of reversible file operations so the user
 * can revert the most recent action with a single button press.
 *
 * The stack is also persisted to disk so it survives plugin restarts.
 *
 * Crash safety (#7):
 *  - Stack writes are atomic (temp file + rename).
 *  - Write actions journal their snapshot BEFORE the batch starts
 *    (beginUndoSnapshot) and persist after each successful operation
 *    (recordUndoOperation), so a crash mid-batch leaves a revertible
 *    undo entry covering exactly the operations that already happened.
 *  - applyUndo() persists progress after each successful revert, so a
 *    crash mid-undo cannot lose already-reverted state either.
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

// ── Change notifications ───────────────────────────────────────────

export type UndoStackListener = (size: number) => void;

/** Listeners notified whenever the persisted undo stack changes. */
const listeners = new Set<UndoStackListener>();

/**
 * Subscribe to undo-stack changes (e.g. the Undo action refreshes its
 * title badge whenever a write action pushes or pops a snapshot).
 * Returns an unsubscribe function.
 */
export function subscribeUndoStack(listener: UndoStackListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyUndoStackChanged(size: number): void {
  for (const listener of listeners) {
    try {
      listener(size);
    } catch {
      // A broken listener must never break a file operation.
    }
  }
}

// ── Persistence ────────────────────────────────────────────────────

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
 * Rewrite the top snapshot on disk, but only if the top snapshot is the
 * given one (matched by timestamp + label, which together identify a
 * journal started by beginUndoSnapshot). No-ops otherwise, so callers
 * that hold a detached snapshot (tests, mid-flight reads) never corrupt
 * the persisted stack.
 */
function persistIfTop(snapshot: UndoSnapshot): void {
  const stack = loadStack();
  const top = stack[stack.length - 1];
  if (!top || top.timestamp !== snapshot.timestamp || top.label !== snapshot.label) return;
  top.operations = snapshot.operations;
  saveStack(stack);
}

// ── Classic (end-of-batch) API ────────────────────────────────────

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
  notifyUndoStackChanged(stack.length);
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
  notifyUndoStackChanged(stack.length);
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

// ── Journaled (crash-safe) API ────────────────────────────────────

/**
 * Start a journaled undo snapshot and persist it IMMEDIATELY, before the
 * batch it describes begins. The snapshot starts empty; the caller records
 * each operation as it succeeds (recordUndoOperation), so a crash at any
 * point leaves a revertible entry covering exactly the operations that
 * actually happened — previously a crash mid-batch left files renamed
 * with no undo entry at all (#7).
 *
 * Must be called while holding the fs lock (i.e. from inside a
 * withFsLock() batch) so the journal is unambiguously the top snapshot.
 */
export function beginUndoSnapshot(label: string): UndoSnapshot {
  const snapshot: UndoSnapshot = {
    label,
    timestamp: new Date().toISOString(),
    operations: []
  };
  const stack = loadStack();
  stack.push(snapshot);
  if (stack.length > MAX_UNDO_SNAPSHOTS) {
    stack.splice(0, stack.length - MAX_UNDO_SNAPSHOTS);
  }
  saveStack(stack);
  notifyUndoStackChanged(stack.length);
  return snapshot;
}

/**
 * Record one successfully applied operation on a journal started with
 * beginUndoSnapshot() and persist it right away. Persistence cost is one
 * small atomic write per operation; batches are serialized under the fs
 * lock, so the journal is always the top snapshot while the batch runs.
 */
export function recordUndoOperation(snapshot: UndoSnapshot, op: FileOperation): void {
  snapshot.operations.push(op);
  persistIfTop(snapshot);
}

/**
 * Remove a journal started with beginUndoSnapshot() when the batch ended
 * up doing nothing (e.g. every file was already correctly named). Only
 * removes the snapshot if it is still the (empty) top one — a journal
 * that recorded operations is kept, and a snapshot that is no longer on
 * top is left alone.
 */
export function abandonUndoSnapshot(snapshot: UndoSnapshot): void {
  if (snapshot.operations.length > 0) return;
  const stack = loadStack();
  const top = stack[stack.length - 1];
  if (!top || top.timestamp !== snapshot.timestamp || top.label !== snapshot.label) return;
  stack.pop();
  saveStack(stack);
  notifyUndoStackChanged(stack.length);
}

// ── Undo application ──────────────────────────────────────────────

/**
 * Revert all file operations in the snapshot (in reverse order).
 * Returns a list of any errors encountered.
 *
 * The snapshot is trimmed down to the operations that could NOT be
 * reverted, so a subsequent Undo press retries only the remaining
 * operations instead of re-processing (and re-failing) the ones that
 * already reverted. Progress is persisted after every successful revert,
 * so a crash mid-undo cannot lose the already-reverted state either.
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
  // Remaining (not yet reverted) ops in their ORIGINAL order. Ops are
  // reverted from the end of this array; each successful revert is popped
  // and persisted, so a crash mid-undo leaves a consistent snapshot on
  // disk covering exactly the ops that still need reverting.
  const remaining = [...snapshot.operations];
  // Failed ops, collected in reverse-processing order (like the previous
  // implementation) and re-attached in their original order at the end.
  const failedOps: FileOperation[] = [];

  while (remaining.length > 0) {
    const op = remaining[remaining.length - 1] as FileOperation;
    remaining.pop();

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
      continue;
    }

    // Successful revert: persist the reduced snapshot immediately.
    // Failed ops keep their original order ahead of the not-yet-processed
    // remainder (failed ops always come from earlier positions).
    snapshot.operations = [...failedOps.slice().reverse(), ...remaining];
    persistIfTop(snapshot);
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
