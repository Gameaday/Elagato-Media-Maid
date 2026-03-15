/**
 * File renamer for MediaMaid.
 *
 * Applies a NamingPattern to every matching file in a target folder.
 * Supports dry-run mode (preview only) and returns all operations for undo.
 */

import { rename, mkdir, readdir, stat } from "fs/promises";
import { join, extname, basename } from "path";
import type { NamingPattern, FileMetadata } from "./patterns.js";
import { MediaType } from "./patterns.js";
import { findAndParseNfo } from "./nfo-parser.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";
import { validateFolderPath, RELEASE_TAG_RE, ROM_TAG_RE, ROM_REGION_RE, PLATFORM_MAP, RESOLUTION_RE, RESOLUTION_LABELS } from "./config.js";

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

  // Standard SxxExx pattern (with optional multi-episode E##)
  // Group 1: show title (before separator + SxxExx)
  // Group 2: season number  (1-2 digits)
  // Group 3: first episode  (1-3 digits)
  // Group 4: optional episode title (after separator, before release tags)
  const seMatch = /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})(?:[Ee]\d{1,3})?(?:[.\s_-]+(.+))?$/.exec(baseName);
  if (seMatch) {
    meta.title = seMatch[1].replace(/[._]/g, " ").trim();
    meta.season = parseInt(seMatch[2], 10);
    meta.episode = parseInt(seMatch[3], 10);
    if (seMatch[4]) {
      meta.episodeTitle = seMatch[4]
        .replace(/[._]/g, " ")
        .replace(RELEASE_TAG_RE, "")
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
        .replace(RELEASE_TAG_RE, "")
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

  // Track# followed by song title (no artist separator), e.g. "01 Song Title"
  const trackOnly = /^(\d{1,3})[.\s_]+(.+)$/.exec(baseName);
  if (trackOnly) {
    meta.trackNumber = parseInt(trackOnly[1], 10);
    meta.songTitle = trackOnly[2].replace(/[._]/g, " ").trim();
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
 * Parse video resolution from a filename.
 * Handles tokens like "1080p", "2160p", "4K", "720p", "480p", "576p".
 * Returns a normalised label (e.g. "4K" for both "2160p" and "4K").
 */
export function parseResolutionFromFilename(baseName: string): string | undefined {
  const m = RESOLUTION_RE.exec(baseName);
  if (!m) return undefined;
  const raw = m[1];
  return RESOLUTION_LABELS[raw] ?? RESOLUTION_LABELS[raw.toLowerCase()] ?? raw;
}

/**
 * Extract a clean movie title from a filename by stripping year, resolution, and release tags.
 * E.g. "Inception.2010.1080p.BluRay.x264" → "Inception"
 */
export function parseMovieTitle(baseName: string): string {
  return baseName
    .replace(/[._]/g, " ")
    .replace(/\b(19|20)\d{2}\b.*$/, "")
    .replace(RELEASE_TAG_RE, "")
    .trim() || baseName;
}

/**
 * Parse ROM metadata from a filename.
 * Handles formats like:
 *   Super Mario Bros. (USA) [!].nes
 *   Legend of Zelda, The - A Link to the Past (USA) [!].sfc
 *   Sonic the Hedgehog (Japan, USA).gen
 *
 * Extracts game title, region, and maps extension to platform.
 */
export function parseRomPattern(baseName: string, ext: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Extract region from the first parenthesised tag
  const regionMatch = ROM_REGION_RE.exec(baseName);
  if (regionMatch) {
    meta.region = regionMatch[1].trim();
  }

  // Strip scene tags [!], [b], [h1], etc. and parenthesised tags for a clean title
  const title = baseName
    .replace(ROM_TAG_RE, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (title) {
    meta.title = title;
  }

  // Map extension to platform name
  meta.platform = PLATFORM_MAP[ext.toLowerCase()];

  return meta;
}

/**
 * Build FileMetadata from a filename and any NFO data.
 * NFO data takes precedence over filename parsing.
 * Selects the appropriate parser based on the target pattern's media type.
 */
async function buildMetadata(
  filePath: string,
  pattern: NamingPattern,
  index: number
): Promise<FileMetadata> {
  const ext = extname(filePath).toLowerCase();
  const baseName = basename(filePath, ext);

  const nfoMeta = await findAndParseNfo(filePath);

  // Select parser based on the pattern's media type
  const isMusicPattern = pattern.mediaType === MediaType.MUSIC;
  const isTvPattern = pattern.mediaType === MediaType.JELLYFIN_TV;
  const isRomPattern = pattern.mediaType === MediaType.EMULATION_ROMS;
  const isMoviePattern = pattern.mediaType === MediaType.JELLYFIN_MOVIE
    || pattern.mediaType === MediaType.JELLYFIN_MOVIE_VERSION;

  const fromTv = isTvPattern ? parseTvPattern(baseName) : {};
  const fromMusic = isMusicPattern ? parseMusicPattern(baseName) : {};
  const fromRom = isRomPattern ? parseRomPattern(baseName, ext) : {};

  // For movie/photo/book/doc patterns, try TV parsing only for
  // season/episode extraction (useful for metadata) when not music or ROM
  const fromTvFallback = !isMusicPattern && !isTvPattern && !isRomPattern ? parseTvPattern(baseName) : {};

  // For movie patterns, extract a clean title from the filename
  const movieTitle = isMoviePattern ? parseMovieTitle(baseName) : undefined;

  // Merge: NFO takes precedence, then pattern-appropriate parser
  const merged: FileMetadata = {
    baseName,
    ext,
    originalPath: filePath,
    title: nfoMeta.title ?? fromTv.title ?? fromRom.title ?? movieTitle ?? fromTvFallback.title ?? baseName,
    season: nfoMeta.season ?? fromTv.season ?? fromTvFallback.season,
    episode: nfoMeta.episode ?? fromTv.episode ?? fromTvFallback.episode,
    episodeTitle: nfoMeta.episodeTitle ?? fromTv.episodeTitle ?? fromTvFallback.episodeTitle,
    year: nfoMeta.year ?? parseYearFromFilename(baseName),
    artist: nfoMeta.artist ?? fromMusic.artist,
    album: nfoMeta.album,
    trackNumber: nfoMeta.trackNumber ?? fromMusic.trackNumber,
    songTitle: fromMusic.songTitle ?? baseName,
    index,
    platform: fromRom.platform,
    region: fromRom.region,
    resolution: parseResolutionFromFilename(baseName)
  };

  return merged;
}

/**
 * Check if a path exists on the filesystem.
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the proposed filename does not conflict with an existing file.
 * Checks both the in-memory tracking set and the actual filesystem to
 * avoid race conditions with external modifications.
 */
async function deconflict(proposedPath: string, existingFiles: Set<string>): Promise<string> {
  if (!existingFiles.has(proposedPath) && !(await pathExists(proposedPath))) return proposedPath;

  const ext = extname(proposedPath);
  const base = proposedPath.slice(0, -ext.length);
  let counter = 2;
  let candidate: string;
  for (;;) {
    candidate = `${base} (${counter})${ext}`;
    if (!existingFiles.has(candidate) && !(await pathExists(candidate))) break;
    counter++;
  }
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
    entries = await readdir(folderPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors["[folder]"] = `Could not read folder: ${msg}`;
    return result;
  }

  // Filter to files matching the pattern's extensions
  const targetFiles: string[] = [];
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    try {
      const fileStat = await stat(join(folderPath, name));
      if (fileStat.isFile() && pattern.extensions.includes(ext)) {
        targetFiles.push(name);
      }
    } catch {
      // skip unreadable entries
    }
  }

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
    toPath = await deconflict(toPath, existingPaths);

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
    entries = await readdir(libraryRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors["[folder]"] = `Could not read library root: ${msg}`;
    return result;
  }

  const targetFiles: string[] = [];
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    try {
      const fileStat = await stat(join(libraryRoot, name));
      if (fileStat.isFile() && pattern.extensions.includes(ext)) {
        targetFiles.push(name);
      }
    } catch {
      // skip unreadable entries
    }
  }

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
        const dirExisted = await pathExists(targetDir);
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
