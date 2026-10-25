/**
 * Cross-filesystem file helpers for MediaMaid.
 */

import { rename, copyFile, unlink } from "fs/promises";

/**
 * Move a file from one path to another.
 *
 * fs.rename() only works within a single filesystem. When the destination
 * sits on a different device — an external drive, a network share, or a
 * subfolder that is a symlink/junction pointing at one — it fails with
 * EXDEV. Fall back to copy + delete in that case so the operation (and its
 * undo) still succeeds instead of reporting an error.
 */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as { code?: string }).code !== "EXDEV") {
      throw err;
    }
    await copyFile(from, to);
    await unlink(from);
  }
}
