/**
 * Downloads folder organizer for MediaMaid ("Nuke Downloads").
 *
 * Sorts files in a flat folder into categorized subfolders based on their
 * file extension. Uses the centralized extension registry from config.ts.
 */

import { readdirSync, statSync, existsSync } from "fs";
import { rename, mkdir } from "fs/promises";
import { join, extname } from "path";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";
import { SORT_CATEGORIES, validateFolderPath } from "./config.js";

export interface SortRule {
  /** Subfolder name to create */
  folder: string;
  /** Extensions that map to this folder */
  extensions: Set<string>;
}

/** Default sorting rules derived from centralized config */
export const DEFAULT_SORT_RULES: SortRule[] = SORT_CATEGORIES.map(c => ({
  folder: c.folder,
  extensions: c.extensions
}));

export interface OrganizeResult {
  /** Map of folder name → files moved into it */
  moved: Record<string, string[]>;
  /** Files left in place (no matching rule + no "Other" folder, or already in subfolders) */
  unmoved: string[];
  /** Total files moved */
  totalMoved: number;
  /** Errors by filename */
  errors: Record<string, string>;
}

/**
 * Find the sort rule for a file by extension.
 * Returns undefined if no rule matches (will go to "Other").
 */
function findRule(ext: string, rules: SortRule[]): SortRule | undefined {
  return rules.find(r => r.extensions.has(ext.toLowerCase()));
}

/**
 * Sort files in a folder into categorized subfolders.
 *
 * @param folderPath - The directory to sort.
 * @param rules      - Sort rules (defaults to DEFAULT_SORT_RULES).
 * @param dryRun     - If true, no files are moved.
 * @param createOther - If true, unrecognized files go into "Other".
 */
export async function sortFolder(
  folderPath: string,
  rules: SortRule[] = DEFAULT_SORT_RULES,
  dryRun = false,
  createOther = true
): Promise<OrganizeResult> {
  const result: OrganizeResult = {
    moved: {},
    unmoved: [],
    totalMoved: 0,
    errors: {}
  };

  const pathCheck = validateFolderPath(folderPath);
  if (!pathCheck.valid) {
    result.errors["[folder]"] = pathCheck.reason ?? "Invalid path.";
    return result;
  }

  let entries: string[];
  try {
    entries = readdirSync(folderPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors["[folder]"] = `Could not read folder: ${msg}`;
    return result;
  }

  // Only process files (not subfolders already created)
  const files = entries.filter(name => {
    try {
      return statSync(join(folderPath, name)).isFile();
    } catch {
      return false;
    }
  });

  const undoOps: FileOperation[] = [];
  const createdDirs = new Set<string>();

  for (const name of files) {
    const ext = extname(name).toLowerCase();
    const fromPath = join(folderPath, name);
    const rule = findRule(ext, rules);
    const targetFolder = rule?.folder ?? (createOther ? "Other" : null);

    if (!targetFolder) {
      result.unmoved.push(name);
      continue;
    }

    const targetDir = join(folderPath, targetFolder);
    const toPath = join(targetDir, name);

    if (!result.moved[targetFolder]) {
      result.moved[targetFolder] = [];
    }
    result.moved[targetFolder].push(name);

    if (!dryRun) {
      try {
        const dirExisted = existsSync(targetDir);
        await mkdir(targetDir, { recursive: true });
        if (!dirExisted && !createdDirs.has(targetDir)) {
          undoOps.push({ type: "mkdir", from: "", to: targetDir });
          createdDirs.add(targetDir);
        }
        await rename(fromPath, toPath);
        undoOps.push({ type: "move", from: fromPath, to: toPath });
        result.totalMoved++;
        logOperation({ operation: "sort", from: fromPath, to: toPath, message: `Sorted into ${targetFolder}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors[name] = msg;
        logOperation({ operation: "error", from: fromPath, to: toPath, message: msg });
      }
    } else {
      result.totalMoved++;
      logOperation({ operation: "dryrun", from: fromPath, to: toPath, message: `DRY RUN – would sort into ${targetFolder}` });
    }
  }

  if (!dryRun && undoOps.length > 0) {
    pushUndoSnapshot(createSnapshot("Nuke Downloads – Sort by Type", undoOps));
  }

  return result;
}
