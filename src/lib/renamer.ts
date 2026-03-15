/**
 * File renamer for MediaMaid.
 *
 * Applies a NamingPattern to every matching file in a target folder.
 * Supports dry-run mode (preview only) and returns all operations for undo.
 */

import { rename, mkdir, readdir, stat } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import type { NamingPattern, FileMetadata } from "./patterns.js";
import { MediaType } from "./patterns.js";
import { findAndParseNfo } from "./nfo-parser.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";
import { validateFolderPath, RELEASE_TAG_RE, ROM_TAG_RE, ROM_REGION_RE, PLATFORM_MAP, RESOLUTION_RE, RESOLUTION_LABELS, SOURCE_TAG_RE, SOURCE_LABELS, HDR_TAG_RE, HDR_LABELS, YOUTUBE_ID_RE, ABSOLUTE_EPISODE_RE, COMIC_VOLUME_RE, COMIC_CHAPTER_RE } from "./config.js";

/**
 * Extract title and year from a folder name.
 * Handles patterns like "Title (Year)", "Title - Year", "Season NN".
 */
function folderMeta(folderName: string): { title?: string; year?: number; season?: number } {
  const result: { title?: string; year?: number; season?: number } = {};

  const seasonMatch = /^[Ss]eason\s*(\d{1,3})$/i.exec(folderName);
  if (seasonMatch) {
    result.season = parseInt(seasonMatch[1], 10);
    return result;
  }

  const titleYear = /^(.+?)\s*[\(\[]?((?:19|20)\d{2})[\)\]]?\s*$/.exec(folderName);
  if (titleYear) {
    result.title = titleYear[1].replace(/[_.-]+$/, "").trim();
    result.year = parseInt(titleYear[2], 10);
    return result;
  }

  const titleDash = /^(.+?)\s*-\s*((?:19|20)\d{2})\s*$/.exec(folderName);
  if (titleDash) {
    result.title = titleDash[1].trim();
    result.year = parseInt(titleDash[2], 10);
    return result;
  }

  if (folderName.trim()) {
    result.title = folderName.trim();
  }
  return result;
}

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
 * Parse the video source tag from a filename (e.g. "BluRay", "WEB-DL", "REMUX").
 * Returns a normalised label.
 */
export function parseSourceFromFilename(baseName: string): string | undefined {
  const m = SOURCE_TAG_RE.exec(baseName);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  return SOURCE_LABELS[raw] ?? m[1];
}

/**
 * Parse HDR/dynamic-range tag from a filename (e.g. "HDR", "HDR10+", "DV").
 * Returns a normalised label.
 */
export function parseHdrFromFilename(baseName: string): string | undefined {
  const m = HDR_TAG_RE.exec(baseName);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  return HDR_LABELS[raw] ?? m[1];
}

/**
 * Build a full Jellyfin-style version tag from filename components.
 * Combines resolution, source, and HDR info into a single bracket tag.
 * E.g. "1080p Bluray", "4K HDR", "2160p Bluray Remux DV"
 */
export function buildVersionTag(baseName: string): string | undefined {
  const parts: string[] = [];
  const res = parseResolutionFromFilename(baseName);
  if (res) parts.push(res);
  const src = parseSourceFromFilename(baseName);
  if (src) parts.push(src);
  const hdr = parseHdrFromFilename(baseName);
  if (hdr) parts.push(hdr);
  return parts.length > 0 ? parts.join(" ") : undefined;
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
 * Parse YouTube / yt-dlp download metadata from a filename.
 * Handles formats like:
 *   "Video Title [dQw4w9WgXcQ].mp4"
 *   "Channel - Video Title [dQw4w9WgXcQ].mp4"
 *   "20230615 Video Title [dQw4w9WgXcQ].webm"
 */
export function parseYoutubePattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Extract video ID from [ID] at end
  const idMatch = YOUTUBE_ID_RE.exec(baseName);
  if (idMatch) {
    meta.videoId = idMatch[1];
  }

  // Remove the video ID bracket from the title
  let cleaned = baseName.replace(YOUTUBE_ID_RE, "").trim();

  // Try to extract uploader/channel from "Channel - Title" format
  const channelMatch = /^(.+?)\s*-\s+(.+)$/.exec(cleaned);
  if (channelMatch) {
    meta.uploader = channelMatch[1].trim();
    meta.title = channelMatch[2].trim();
  } else {
    meta.title = cleaned;
  }

  // Try to extract date from YYYYMMDD prefix
  const datePrefix = /^(\d{4})(\d{2})(\d{2})\s+/.exec(cleaned);
  if (datePrefix) {
    meta.dateTaken = `${datePrefix[1]}-${datePrefix[2]}-${datePrefix[3]}`;
    meta.title = cleaned.replace(/^\d{8}\s+/, "").trim();
  }

  return meta;
}

/**
 * Parse anime metadata from a filename.
 * Handles formats like:
 *   "[SubGroup] Anime Title - 01 [1080p].mkv"
 *   "Anime Title - 001 - Episode Title.mkv"
 *   "Anime.Title.S01E001.Episode.Title.mkv"
 */
export function parseAnimePattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Strip fansub group tags: [SubGroup]
  let cleaned = baseName.replace(/^\[([^\]]+)\]\s*/, "");

  // Strip trailing quality tags: [1080p], [720p], etc.
  cleaned = cleaned.replace(/\s*\[\d+p\]$/, "").trim();

  // Try SxxExx pattern first
  const seMatch = /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,4})(?:[.\s_-]+(.+))?$/.exec(cleaned);
  if (seMatch) {
    meta.title = seMatch[1].replace(/[._]/g, " ").trim();
    meta.season = parseInt(seMatch[2], 10);
    meta.absoluteEpisode = parseInt(seMatch[3], 10);
    meta.episode = meta.absoluteEpisode;
    if (seMatch[4]) {
      meta.episodeTitle = seMatch[4].replace(/[._]/g, " ").replace(RELEASE_TAG_RE, "").trim();
    }
    return meta;
  }

  // Absolute numbering: "Title - 001" or "Title - 001 - Episode Title"
  const absMatch = ABSOLUTE_EPISODE_RE.exec(cleaned);
  if (absMatch) {
    meta.absoluteEpisode = parseInt(absMatch[1], 10);
    meta.episode = meta.absoluteEpisode;
    // Extract title (everything before the episode number pattern)
    const titlePart = cleaned.slice(0, absMatch.index).replace(/[.\s_-]+$/, "").replace(/[._]/g, " ").trim();
    if (titlePart) meta.title = titlePart;
    // Extract episode title (everything after the episode number)
    const afterEp = cleaned.slice(absMatch.index + absMatch[0].length).replace(/^[.\s_-]+/, "").replace(/[._]/g, " ").replace(RELEASE_TAG_RE, "").trim();
    if (afterEp) meta.episodeTitle = afterEp;
  }

  return meta;
}

/**
 * Parse podcast metadata from a filename.
 * Handles formats like:
 *   "Show Name - 2024-01-15 - Episode Title.mp3"
 *   "Show Name - Episode Title.mp3"
 *   "2024-01-15 - Episode Title.mp3"
 */
export function parsePodcastPattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Try: "Show - YYYY-MM-DD - Episode" or "Show - YYYY-MM-DD"
  const fullMatch = /^(.+?)\s*-\s*(\d{4}-\d{2}-\d{2})\s*-\s*(.+)$/.exec(baseName);
  if (fullMatch) {
    meta.showName = fullMatch[1].trim();
    meta.dateTaken = fullMatch[2];
    meta.episodeTitle = fullMatch[3].trim();
    return meta;
  }

  // Try: "Show - YYYY-MM-DD"
  const showDateMatch = /^(.+?)\s*-\s*(\d{4}-\d{2}-\d{2})$/.exec(baseName);
  if (showDateMatch) {
    meta.showName = showDateMatch[1].trim();
    meta.dateTaken = showDateMatch[2];
    return meta;
  }

  // Try: "YYYY-MM-DD - Episode Title"
  const dateEpMatch = /^(\d{4}-\d{2}-\d{2})\s*-\s*(.+)$/.exec(baseName);
  if (dateEpMatch) {
    meta.dateTaken = dateEpMatch[1];
    meta.episodeTitle = dateEpMatch[2].trim();
    return meta;
  }

  // Try: "Show - Episode Title"
  const showEpMatch = /^(.+?)\s*-\s*(.+)$/.exec(baseName);
  if (showEpMatch) {
    meta.showName = showEpMatch[1].trim();
    meta.episodeTitle = showEpMatch[2].trim();
    return meta;
  }

  return meta;
}

/**
 * Parse comic/manga metadata from a filename.
 * Handles formats like:
 *   "One Piece Vol 01 Ch 001.cbz"
 *   "Batman #042.cbz"
 *   "Spider-Man v3 #15.cbz"
 *   "Naruto Chapter 100.cbz"
 */
export function parseComicPattern(baseName: string): Partial<FileMetadata> {
  const meta: Partial<FileMetadata> = {};

  // Extract volume
  const volMatch = COMIC_VOLUME_RE.exec(baseName);
  if (volMatch) {
    meta.volume = parseInt(volMatch[1], 10);
  }

  // Extract chapter
  const chMatch = COMIC_CHAPTER_RE.exec(baseName);
  if (chMatch) {
    meta.chapter = parseInt(chMatch[1], 10);
  }

  // Extract title: everything before the first vol/chapter/issue marker
  let title = baseName
    .replace(COMIC_VOLUME_RE, "")
    .replace(COMIC_CHAPTER_RE, "")
    .replace(/#\d+/, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (title) meta.title = title;

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
  const isAnimePattern = pattern.mediaType === MediaType.ANIME;
  const isYoutubePattern = pattern.mediaType === MediaType.YOUTUBE_ARCHIVE;
  const isPodcastPattern = pattern.mediaType === MediaType.PODCAST_ARCHIVE;
  const isComicPattern = pattern.mediaType === MediaType.COMICS;

  const fromTv = isTvPattern ? parseTvPattern(baseName) : {};
  const fromMusic = isMusicPattern ? parseMusicPattern(baseName) : {};
  const fromRom = isRomPattern ? parseRomPattern(baseName, ext) : {};
  const fromAnime = isAnimePattern ? parseAnimePattern(baseName) : {};
  const fromYoutube = isYoutubePattern ? parseYoutubePattern(baseName) : {};
  const fromPodcast = isPodcastPattern ? parsePodcastPattern(baseName) : {};
  const fromComic = isComicPattern ? parseComicPattern(baseName) : {};

  // For movie/photo/book/doc patterns, try TV parsing only for
  // season/episode extraction (useful for metadata) when not music or ROM
  const fromTvFallback = !isMusicPattern && !isTvPattern && !isRomPattern && !isAnimePattern && !isYoutubePattern && !isPodcastPattern && !isComicPattern ? parseTvPattern(baseName) : {};

  // For movie patterns, extract a clean title from the filename
  const movieTitle = isMoviePattern ? parseMovieTitle(baseName) : undefined;

  // Merge: NFO takes precedence, then pattern-appropriate parser
  const merged: FileMetadata = {
    baseName,
    ext,
    originalPath: filePath,
    title: nfoMeta.title ?? fromTv.title ?? fromAnime.title ?? fromComic.title ?? fromYoutube.title ?? fromPodcast.showName ?? fromRom.title ?? movieTitle ?? fromTvFallback.title ?? baseName,
    season: nfoMeta.season ?? fromTv.season ?? fromAnime.season ?? fromTvFallback.season,
    episode: nfoMeta.episode ?? fromTv.episode ?? fromAnime.episode ?? fromTvFallback.episode,
    episodeTitle: nfoMeta.episodeTitle ?? fromTv.episodeTitle ?? fromAnime.episodeTitle ?? fromPodcast.episodeTitle ?? fromTvFallback.episodeTitle,
    year: nfoMeta.year ?? parseYearFromFilename(baseName),
    artist: nfoMeta.artist ?? fromMusic.artist,
    album: nfoMeta.album,
    trackNumber: nfoMeta.trackNumber ?? fromMusic.trackNumber,
    songTitle: fromMusic.songTitle ?? baseName,
    index,
    platform: fromRom.platform,
    region: fromRom.region,
    resolution: parseResolutionFromFilename(baseName),
    source: parseSourceFromFilename(baseName),
    hdr: parseHdrFromFilename(baseName),
    versionTag: buildVersionTag(baseName),
    absoluteEpisode: fromAnime.absoluteEpisode,
    uploader: fromYoutube.uploader,
    videoId: fromYoutube.videoId,
    showName: fromPodcast.showName,
    volume: fromComic.volume,
    chapter: fromComic.chapter,
    dateTaken: fromYoutube.dateTaken ?? fromPodcast.dateTaken
  };

  // Enrich from parent folder context when parsers couldn't extract metadata.
  // Folder names are a reliable fallback since users typically organise files
  // into named directories (e.g. "Show Name/", "Artist Name/", "Channel/").
  const folderCtx = folderMeta(basename(dirname(filePath)));

  if (isPodcastPattern && !merged.showName && folderCtx.title) {
    merged.showName = folderCtx.title;
  }
  if (isYoutubePattern && !merged.uploader && folderCtx.title) {
    merged.uploader = folderCtx.title;
  }
  if (isComicPattern && merged.title === baseName && folderCtx.title) {
    merged.title = folderCtx.title;
  }
  if ((isTvPattern || isAnimePattern) && merged.title === baseName && folderCtx.title) {
    merged.title = folderCtx.title;
  }
  if (isMoviePattern && !merged.year && folderCtx.year) {
    merged.year = folderCtx.year;
  }
  if (isMusicPattern && !merged.artist && folderCtx.title) {
    merged.artist = folderCtx.title;
  }

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
