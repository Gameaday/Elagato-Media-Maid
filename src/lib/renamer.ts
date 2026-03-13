/**
 * File renamer for MediaMaid.
 *
 * Applies a NamingPattern to every matching file in a target folder.
 * Supports dry-run mode (preview only) and returns all operations for undo.
 */

import { readdirSync, statSync } from "fs";
import { rename, mkdir } from "fs/promises";
import { join, extname, basename } from "path";
import type { NamingPattern, FileMetadata } from "./patterns.js";
import { findAndParseNfo } from "./nfo-parser.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";

export interface RenameOperation {
  /** Original full path */
  from: string;
  /** Proposed full path */
  to: string;
  /** True if from === to (no change needed) */
  unchanged: boolean;
}

export interface RenameResult {
  /** Operations that were performed (or would be performed in dry-run) */
  operations: RenameOperation[];
  /** Number of files renamed */
  renamed: number;
  /** Number of files already correctly named */
  skipped: number;
  /** Errors encountered (filename → error message) */
  errors: Record<string, string>;
}

/**
 * Parse common TV episode patterns from an existing filename.
 * Handles formats like:
 *   ShowName.S01E02.EpisodeTitle.mkv
 *   Show Name - 1x02 - Episode Title.mkv
 *   ShowName_S01E02_mkv
 */
export function parseTvPattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Standard SxxExx pattern
  const seMatch = /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,2})(?:[.\s_-]+(.+))?$/.exec(baseName);
  if (seMatch) {
    meta.title = seMatch[1].replace(/[._]/g, " ").trim();
    meta.season = parseInt(seMatch[2], 10);
    meta.episode = parseInt(seMatch[3], 10);
    if (seMatch[4]) {
      meta.episodeTitle = seMatch[4].replace(/[._]/g, " ").trim();
    }
    return meta;
  }

  // NxNN pattern (1x02)
  const nxMatch = /^(.*?)[.\s_-]+(\d{1,2})x(\d{2})(?:[.\s_-]+(.+))?$/.exec(baseName);
  if (nxMatch) {
    meta.title = nxMatch[1].replace(/[._]/g, " ").trim();
    meta.season = parseInt(nxMatch[2], 10);
    meta.episode = parseInt(nxMatch[3], 10);
    if (nxMatch[4]) {
      meta.episodeTitle = nxMatch[4].replace(/[._]/g, " ").trim();
    }
    return meta;
  }

  return meta;
}

/**
 * Parse year from a filename like "Movie.Title.2023.mkv" or "Movie Title (2023).mkv".
 */
export function parseYearFromFilename(baseName: string): number | undefined {
  const m = /\b(19\d{2}|20\d{2})\b/.exec(baseName);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Build FileMetadata from a filename and any NFO data.
 * NFO data takes precedence over filename parsing.
 */
async function buildMetadata(
  filePath: string,
  pattern: NamingPattern,
  index: number
): Promise<FileMetadata> {
  const ext = extname(filePath).toLowerCase();
  const baseName = basename(filePath, ext);

  const nfoMeta = await findAndParseNfo(filePath);

  // Start with filename-parsed data
  const fromFilename: Partial<FileMetadata> = parseTvPattern(baseName);

  // Merge: NFO takes precedence
  const merged: FileMetadata = {
    baseName,
    ext,
    originalPath: filePath,
    title: nfoMeta.title ?? fromFilename.title ?? baseName,
    season: nfoMeta.season ?? fromFilename.season,
    episode: nfoMeta.episode ?? fromFilename.episode,
    episodeTitle: nfoMeta.episodeTitle ?? fromFilename.episodeTitle,
    year: nfoMeta.year ?? parseYearFromFilename(baseName),
    artist: nfoMeta.artist,
    album: nfoMeta.album,
    trackNumber: nfoMeta.trackNumber,
    songTitle: baseName,
    index
  };

  return merged;
}

/**
 * Ensure the proposed filename does not conflict with an existing file.
 * If it does, append a counter suffix.
 */
function deconflict(proposedPath: string, existingFiles: Set<string>): string {
  if (!existingFiles.has(proposedPath)) return proposedPath;

  const ext = extname(proposedPath);
  const base = proposedPath.slice(0, -ext.length);
  let counter = 2;
  while (existingFiles.has(`${base} (${counter})${ext}`)) counter++;
  return `${base} (${counter})${ext}`;
}

/**
 * Apply a naming pattern to all matching files in a folder.
 *
 * @param folderPath - The directory to operate on.
 * @param pattern    - The naming pattern to apply.
 * @param dryRun     - If true, no files are actually renamed.
 * @returns          - Summary of operations performed.
 */
export async function renameFolder(
  folderPath: string,
  pattern: NamingPattern,
  dryRun = false
): Promise<RenameResult> {
  const result: RenameResult = {
    operations: [],
    renamed: 0,
    skipped: 0,
    errors: {}
  };

  let entries: string[];
  try {
    entries = readdirSync(folderPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors["[folder]"] = `Could not read folder: ${msg}`;
    return result;
  }

  // Filter to files matching the pattern's extensions
  const targetFiles = entries.filter(name => {
    const ext = extname(name).toLowerCase();
    let stat;
    try {
      stat = statSync(join(folderPath, name));
    } catch {
      return false;
    }
    return stat.isFile() && pattern.extensions.includes(ext);
  });

  // Build a set of all file paths currently in the folder for deconfliction
  const existingPaths = new Set(
    entries.map(n => join(folderPath, n))
  );

  const undoOps: FileOperation[] = [];

  for (let i = 0; i < targetFiles.length; i++) {
    const name = targetFiles[i];
    const fromPath = join(folderPath, name);

    let meta: FileMetadata;
    try {
      meta = await buildMetadata(fromPath, pattern, i + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors[name] = `Metadata error: ${msg}`;
      continue;
    }

    const newName = pattern.format(meta);
    let toPath = join(folderPath, newName);
    toPath = deconflict(toPath, existingPaths);

    const op: RenameOperation = {
      from: fromPath,
      to: toPath,
      unchanged: fromPath === toPath
    };
    result.operations.push(op);

    if (op.unchanged) {
      result.skipped++;
      continue;
    }

    if (!dryRun) {
      try {
        await rename(fromPath, toPath);
        existingPaths.delete(fromPath);
        existingPaths.add(toPath);
        undoOps.push({ type: "rename", from: fromPath, to: toPath });
        result.renamed++;
        logOperation({ operation: "rename", from: fromPath, to: toPath, message: "OK" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors[name] = msg;
        logOperation({ operation: "error", from: fromPath, to: toPath, message: msg });
      }
    } else {
      logOperation({ operation: "dryrun", from: fromPath, to: toPath, message: "DRY RUN – no change made" });
    }
  }

  if (!dryRun && undoOps.length > 0) {
    pushUndoSnapshot(createSnapshot(`Quick Rename – ${pattern.label}`, undoOps));
  }

  return result;
}

/**
 * Apply a naming pattern with folder structuring (creates subfolders and moves files).
 * Used for Jellyfin TV and Music patterns.
 *
 * @param libraryRoot - Root of the media library.
 * @param pattern     - Pattern with a folderPath() function.
 * @param dryRun      - If true, no files are actually moved.
 */
export async function organizeWithFolderStructure(
  libraryRoot: string,
  pattern: NamingPattern,
  dryRun = false
): Promise<RenameResult> {
  if (!pattern.folderPath) {
    // Fall back to flat rename
    return renameFolder(libraryRoot, pattern, dryRun);
  }

  const result: RenameResult = {
    operations: [],
    renamed: 0,
    skipped: 0,
    errors: {}
  };

  let entries: string[];
  try {
    entries = readdirSync(libraryRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors["[folder]"] = `Could not read library root: ${msg}`;
    return result;
  }

  const targetFiles = entries.filter(name => {
    const ext = extname(name).toLowerCase();
    let stat;
    try {
      stat = statSync(join(libraryRoot, name));
    } catch {
      return false;
    }
    return stat.isFile() && pattern.extensions.includes(ext);
  });

  const undoOps: FileOperation[] = [];

  for (let i = 0; i < targetFiles.length; i++) {
    const name = targetFiles[i];
    const fromPath = join(libraryRoot, name);

    let meta: FileMetadata;
    try {
      meta = await buildMetadata(fromPath, pattern, i + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors[name] = `Metadata error: ${msg}`;
      continue;
    }

    const newName = pattern.format(meta);
    const subFolder = pattern.folderPath!(meta);
    const targetDir = join(libraryRoot, subFolder);
    const toPath = join(targetDir, newName);

    const op: RenameOperation = { from: fromPath, to: toPath, unchanged: fromPath === toPath };
    result.operations.push(op);

    if (op.unchanged) {
      result.skipped++;
      continue;
    }

    if (!dryRun) {
      try {
        await mkdir(targetDir, { recursive: true });
        undoOps.push({ type: "mkdir", from: "", to: targetDir });
        await rename(fromPath, toPath);
        undoOps.push({ type: "move", from: fromPath, to: toPath });
        result.renamed++;
        logOperation({ operation: "move", from: fromPath, to: toPath, message: "OK" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors[name] = msg;
        logOperation({ operation: "error", from: fromPath, to: toPath, message: msg });
      }
    } else {
      logOperation({ operation: "dryrun", from: fromPath, to: toPath, message: "DRY RUN – no change made" });
    }
  }

  if (!dryRun && undoOps.length > 0) {
    pushUndoSnapshot(createSnapshot(`Organize – ${pattern.label}`, undoOps));
  }

  return result;
}
