/**
 * Persistence for the most recent dry-run preview (#11).
 *
 * Renamer dry runs save a compact summary of what they would change to
 * ~/.mediamaid/last-preview.json so the Smart Fix Property Inspector can
 * show it. The write is atomic (temp file + rename) so a crash can never
 * leave a half-written preview behind, and loading a missing or corrupt
 * file simply reports "no preview".
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { MediaType } from "./patterns.js";

/**
 * Summary of the most recent dry-run rename.
 * Type alias (not interface) so it is structurally assignable to JsonValue
 * for sendToPropertyInspector.
 */
export type DryRunPreview = {
  /** ISO timestamp of the dry run */
  timestamp: string;
  /** Human-readable name of the pattern that was previewed */
  patternLabel: string;
  /** Detected media type the pattern targets */
  mediaType: MediaType;
  /** Folder the dry run was performed on */
  folder: string;
  /** Whether the pattern would create a folder structure (organize mode) */
  createFolderStructure: boolean;
  /** Files that would be renamed/moved (from → to) */
  changed: { from: string; to: string }[];
  /** Files already correctly named */
  unchangedCount: number;
  /** Number of errors the dry run hit */
  errorCount: number;
};

const PREVIEW_DIR = join(homedir(), ".mediamaid");
const PREVIEW_PATH = join(PREVIEW_DIR, "last-preview.json");

/**
 * Persist a dry-run preview (atomic write). Best-effort: a failure to
 * save the preview must never fail the dry run itself.
 */
export function saveLastPreview(preview: DryRunPreview): void {
  try {
    if (!existsSync(PREVIEW_DIR)) {
      mkdirSync(PREVIEW_DIR, { recursive: true });
    }
    const tmp = `${PREVIEW_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(preview, null, 2), "utf-8");
    renameSync(tmp, PREVIEW_PATH);
  } catch {
    // Preview persistence is best-effort; never fail a dry run for it.
  }
}

/**
 * Load the most recent dry-run preview, or undefined when none exists
 * (or the file is unreadable/corrupt).
 */
export function loadLastPreview(): DryRunPreview | undefined {
  try {
    if (!existsSync(PREVIEW_PATH)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(PREVIEW_PATH, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Partial<DryRunPreview>;
    if (
      typeof candidate.patternLabel !== "string" ||
      typeof candidate.folder !== "string" ||
      !Array.isArray(candidate.changed)
    ) {
      return undefined;
    }
    return parsed as DryRunPreview;
  } catch {
    return undefined;
  }
}
