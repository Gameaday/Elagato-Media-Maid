/**
 * Deep Scanner for MediaMaid.
 *
 * Recursively traverses a library root, analyzing naming consistency
 * across all subfolders and reporting files that don't match the expected
 * naming convention for their detected media type.
 */

import { readdir, stat } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { detectMediaType } from "./detector.js";
import { getPattern } from "./patterns.js";
import type { NamingPattern, FileMetadata } from "./patterns.js";
import { parseTvPattern, parseYearFromFilename } from "./renamer.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";
import { rename, mkdir } from "fs/promises";
import { DEFAULT_MAX_DEPTH, validateFolderPath } from "./config.js";

export interface ScanIssue {
  /** Full path to the problematic file */
  filePath: string;
  /** The current filename */
  currentName: string;
  /** What the file should be named */
  suggestedName: string;
  /** Type of issue */
  issueType: "wrong-name" | "wrong-folder" | "missing-nfo" | "inconsistent";
  /** Human-readable description */
  description: string;
}

export interface DeepScanResult {
  /** Total directories scanned */
  directoriesScanned: number;
  /** Total files examined */
  filesExamined: number;
  /** Issues found */
  issues: ScanIssue[];
  /** Number of issues actually auto-fixed (only incremented for real renames) */
  fixed: number;
  /** Number of issues that would be fixed in dry-run mode */
  wouldFix: number;
  /** Errors encountered */
  errors: Record<string, string>;
  /** Health score 0–100 (percentage of correctly named files) */
  healthScore: number;
}

/**
 * Recursively collect all files from a directory tree.
 */
async function collectFilesRecursive(dir: string, maxDepth = DEFAULT_MAX_DEPTH, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];

  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const fullPath = join(dir, name);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory()) {
      results.push(...await collectFilesRecursive(fullPath, maxDepth, depth + 1));
    } else if (fileStat.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Check if a filename matches the expected pattern for its media type.
 */
function checkNaming(filePath: string, pattern: NamingPattern): ScanIssue | null {
  const ext = extname(filePath).toLowerCase();
  if (!pattern.extensions.includes(ext)) return null;

  const currentName = basename(filePath);
  const baseName = basename(filePath, ext);

  const meta: FileMetadata = {
    baseName,
    ext,
    originalPath: filePath,
    ...parseTvPattern(baseName),
    year: parseYearFromFilename(baseName)
  };

  if (!meta.title) meta.title = baseName;

  const expectedName = pattern.format(meta);

  if (currentName === expectedName) return null;

  return {
    filePath,
    currentName,
    suggestedName: expectedName,
    issueType: "wrong-name",
    description: `Expected "${expectedName}" but found "${currentName}"`
  };
}

/**
 * Perform a deep scan of a library directory.
 */
export async function deepScan(
  libraryRoot: string,
  autoFix = false,
  dryRun = false
): Promise<DeepScanResult> {
  const result: DeepScanResult = {
    directoriesScanned: 0,
    filesExamined: 0,
    issues: [],
    fixed: 0,
    wouldFix: 0,
    errors: {},
    healthScore: 100
  };

  const pathCheck = validateFolderPath(libraryRoot);
  if (!pathCheck.valid) {
    result.errors["[path]"] = pathCheck.reason ?? "Invalid path.";
    result.healthScore = 0;
    return result;
  }

  const allFiles = await collectFilesRecursive(libraryRoot);
  result.filesExamined = allFiles.length;

  // Count unique directories
  const dirs = new Set(allFiles.map(f => dirname(f)));  result.directoriesScanned = dirs.size;

  if (allFiles.length === 0) {
    result.healthScore = 100;
    return result;
  }

  // Detect the library's media type
  const detection = await detectMediaType(libraryRoot);
  const pattern = getPattern(detection.mediaType);

  if (!pattern) {
    result.errors["[detection]"] = `Could not determine media type (detected: ${detection.mediaType})`;
    result.healthScore = 0;
    return result;
  }

  // Check each file against the pattern
  for (const filePath of allFiles) {
    const issue = checkNaming(filePath, pattern);
    if (issue) {
      result.issues.push(issue);
    }
  }

  // Calculate health score
  const matchingCount = allFiles.length - result.issues.length;
  result.healthScore = Math.round((matchingCount / allFiles.length) * 100);

  // Auto-fix if requested
  if (autoFix && result.issues.length > 0) {
    const undoOps: FileOperation[] = [];

    for (const issue of result.issues) {
      if (dryRun) {
        const dir = dirname(issue.filePath);
        const newPath = join(dir, issue.suggestedName);
        logOperation({
          operation: "dryrun",
          from: issue.filePath,
          to: newPath,
          message: `DRY RUN – would fix: ${issue.description}`
        });
        result.wouldFix++;
      } else {
        try {
          const dir = dirname(issue.filePath);
          const newPath = join(dir, issue.suggestedName);
          await mkdir(dir, { recursive: true });
          await rename(issue.filePath, newPath);
          undoOps.push({ type: "rename", from: issue.filePath, to: newPath });
          result.fixed++;
          logOperation({
            operation: "rename",
            from: issue.filePath,
            to: newPath,
            message: `Deep scan fix: ${issue.description}`
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors[issue.filePath] = msg;
        }
      }
    }

    if (!dryRun && undoOps.length > 0) {
      pushUndoSnapshot(createSnapshot(`Deep Scan Fix – ${pattern.label}`, undoOps));
    }
  }

  return result;
}
