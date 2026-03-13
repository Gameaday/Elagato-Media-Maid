/**
 * File renamer for MediaMaid.
 *
 * Applies a NamingPattern to every matching file in a target folder.
 * Supports dry-run mode (preview only) and returns all operations for undo.
 */

import { readdirSync, statSync, existsSync } from "fs";
import { rename, mkdir } from "fs/promises";
import { join, extname, basename } from "path";
import type { NamingPattern, FileMetadata } from "./patterns.js";
import { findAndParseNfo } from "./nfo-parser.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";
import { validateFolderPath } from "./config.js";

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
 *   ShowName.S01E02E03.mkv  (multi-episode)
 */
export function parseTvPattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Standard SxxExx pattern (with optional multi-episode)
  const seMatch = /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})(?:[Ee]\d{1,3})?(?:[.\s_-]+(.+))?$/.exec(baseName);
  if (seMatch) {
    meta.title = seMatch[1].replace(/[._]/g, " ").trim();
    meta.season = parseInt(seMatch[2], 10);
    meta.episode = parseInt(seMatch[3], 10);
    if (seMatch[4]) {
      meta.episodeTitle = seMatch[4]
        .replace(/[._]/g, " ")
        .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-?DL|HDTV|x264|x265|HEVC|AAC|DTS)\b.*/i, "")
        .trim();
    }
    return meta;
  }

  // NxNN pattern (1x02)
  const nxMatch = /^(.*?)[.\s_-]+(\d{1,2})x(\d{2,3})(?:[.\s_-]+(.+))?$/.exec(baseName);
  if (nxMatch) {
    meta.title = nxMatch[1].replace(/[._]/g, " ").trim();
    meta.season = parseInt(nxMatch[2], 10);
    meta.episode = parseInt(nxMatch[3], 10);
    if (nxMatch[4]) {
      meta.episodeTitle = nxMatch[4]
        .replace(/[._]/g, " ")
        .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-?DL|HDTV|x264|x265|HEVC|AAC|DTS)\b.*/i, "")
        .trim();
    }
    return meta;
  }

  return meta;
}

/**
 * Parse music metadata from a filename.
 * Handles formats like:
 *   01 - Artist - Song Title
 *   01. Artist - Song Title
 *   Artist - Song Title
 *   01 Song Title
 */
export function parseMusicPattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Track# - Artist - Song  OR  Track#. Artist - Song
  const full = /^(\d{1,3})[.\s_-]+(.+?)\s*-\s*(.+)$/.exec(baseName);
  if (full) {
    meta.trackNumber = parseInt(full[1], 10);
    meta.artist = full[2].trim();
    meta.songTitle = full[3].trim();
    return meta;
  }

  // Artist - Song (no track#)
  const noTrack = /^(.+?)\s*-\s*(.+)$/.exec(baseName);
  if (noTrack) {
    meta.artist = noTrack[1].trim();
    meta.songTitle = noTrack[2].trim();
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
 * Uses the appropriate parser based on the target pattern type.
 */
async function buildMetadata(
  filePath: string,
  pattern: NamingPattern,
  index: number
): Promise<FileMetadata> {
  const ext = extname(filePath).toLowerCase();
  const baseName = basename(filePath, ext);

  const nfoMeta = await findAndParseNfo(filePath);

  // Choose parser based on pattern type
  const fromTv = parseTvPattern(baseName);
  const fromMusic = parseMusicPattern(baseName);

  // Merge: NFO takes precedence, then pattern-appropriate parser
  const merged: FileMetadata = {
    baseName,
    ext,
    originalPath: filePath,
    title: nfoMeta.title ?? fromTv.title ?? baseName,
    season: nfoMeta.season ?? fromTv.season,
    episode: nfoMeta.episode ?? fromTv.episode,
    episodeTitle: nfoMeta.episodeTitle ?? fromTv.episodeTitle,
    year: nfoMeta.year ?? parseYearFromFilename(baseName),
    artist: nfoMeta.artist ?? fromMusic.artist,
    album: nfoMeta.album,
    trackNumber: nfoMeta.trackNumber ?? fromMusic.trackNumber,
    songTitle: fromMusic.songTitle ?? baseName,
    index
  };

  return merged;
}

/**
 * Ensure the proposed filename does not conflict with an existing file.
 * Checks both the in-memory tracking set and the actual filesystem to
 * avoid race conditions with external modifications.
 */
function deconflict(proposedPath: string, existingFiles: Set<string>): string {
  if (!existingFiles.has(proposedPath) && !existsSync(proposedPath)) return proposedPath;

  const ext = extname(proposedPath);
  const base = proposedPath.slice(0, -ext.length);
  let counter = 2;
  let candidate: string;
  do {
    candidate = `${base} (${counter})${ext}`;
    counter++;
  } while (existingFiles.has(candidate) || existsSync(candidate));
  return candidate;
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
  const createdDirs = new Set<string>();

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
        const dirExisted = existsSync(targetDir);
        await mkdir(targetDir, { recursive: true });
        if (!dirExisted && !createdDirs.has(targetDir)) {
          undoOps.push({ type: "mkdir", from: "", to: targetDir });
          createdDirs.add(targetDir);
        }
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
