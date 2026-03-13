/**
 * Centralized configuration and extension registry for MediaMaid.
 *
 * Single source of truth for all file-type extensions, timeouts, limits,
 * and other configurable values. Keeps the codebase DRY and makes it
 * trivial to adjust behaviour from one place.
 */

// ── Interaction timing ─────────────────────────────────────────────

/** Milliseconds a key must be held to trigger a long-press action */
export const LONG_PRESS_MS = 500;

/** Milliseconds to show transient status before resetting the title */
export const STATUS_RESET_MS = 3_000;

/** Milliseconds to show scan/health results before resetting the title */
export const SCAN_RESET_MS = 5_000;

// ── Undo system ────────────────────────────────────────────────────

/** Maximum number of undo snapshots kept on disk */
export const MAX_UNDO_SNAPSHOTS = 10;

// ── Scanner / stats limits ─────────────────────────────────────────

/** Default maximum directory depth for recursive scans */
export const DEFAULT_MAX_DEPTH = 5;

/** Default maximum directory depth for extension collection (detection) */
export const DETECTION_MAX_DEPTH = 1;

/** Minimum auto-refresh interval for Library Stats (seconds) */
export const MIN_REFRESH_INTERVAL_S = 30;

/** Default minimum confidence threshold for SmartFix */
export const DEFAULT_MIN_CONFIDENCE = 0.4;

// ── Centralized extension registry ─────────────────────────────────
//
// Every module should reference these sets instead of defining its own.
// When a new format needs support, add it here and it propagates everywhere.
// ────────────────────────────────────────────────────────────────────

export const VIDEO_EXTS = new Set([
  ".mkv", ".mp4", ".avi", ".m4v", ".ts", ".mov", ".wmv", ".webm",
  ".flv", ".mpg", ".mpeg", ".3gp", ".ogv", ".vob"
]);

export const PHOTO_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".heic", ".heif", ".raw", ".arw", ".cr2",
  ".cr3", ".nef", ".orf", ".rw2", ".dng", ".tiff", ".tif", ".webp",
  ".gif", ".bmp", ".svg", ".avif"
]);

export const AUDIO_EXTS = new Set([
  ".flac", ".mp3", ".aac", ".ogg", ".opus", ".wav", ".m4a",
  ".wma", ".alac", ".ape", ".aiff", ".aif", ".dsf", ".dff", ".wv"
]);

export const EBOOK_EXTS = new Set([
  ".epub", ".mobi", ".azw", ".azw3", ".cbz", ".cbr", ".fb2", ".lit"
]);

export const DOCUMENT_EXTS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".md", ".csv", ".rtf", ".odt", ".ods", ".odp", ".pages", ".numbers"
]);

export const INSTALLER_EXTS = new Set([
  ".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm", ".appimage",
  ".iso", ".img", ".snap", ".flatpak"
]);

export const ARCHIVE_EXTS = new Set([
  ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".zst",
  ".tar.gz", ".tar.bz2", ".tar.xz", ".lz4"
]);

export const CODE_EXTS = new Set([
  ".js", ".ts", ".py", ".java", ".cs", ".cpp", ".c", ".h", ".go",
  ".rs", ".rb", ".php", ".html", ".css", ".json", ".xml", ".yaml", ".yml",
  ".sh", ".bat", ".ps1", ".swift", ".kt", ".lua", ".r", ".sql"
]);

export const NFO_EXTS = new Set([".nfo"]);

export const SUBTITLE_EXTS = new Set([
  ".srt", ".sub", ".ass", ".ssa", ".vtt", ".idx"
]);

// ── Naming pattern extension lists (for renamer / patterns.ts) ─────

/** Regex to strip release group tags from parsed episode titles */
export const RELEASE_TAG_RE = /\b(720p|1080p|2160p|4K|BluRay|WEB-?DL|HDTV|x264|x265|HEVC|AAC|DTS)\b.*/i;

/**
 * Extensions recognised as TV/movie video files.
 * Excludes legacy/specialised formats (.flv, .mpg, .mpeg, .3gp, .ogv, .vob)
 * that are rarely found in modern TV/movie libraries.
 */
export const TV_VIDEO_EXTENSIONS = Array.from(VIDEO_EXTS).filter(
  e => ![".flv", ".mpg", ".mpeg", ".3gp", ".ogv", ".vob"].includes(e)
);

/**
 * Extensions recognised for photography patterns.
 * Excludes web/vector graphics (.gif, .bmp, .svg) and formats (.avif)
 * not typically produced by cameras.
 */
export const PHOTO_EXTENSIONS = Array.from(PHOTO_EXTS).filter(
  e => ![".gif", ".bmp", ".svg", ".avif"].includes(e)
);

/** Extensions recognised for music patterns */
export const MUSIC_EXTENSIONS = Array.from(AUDIO_EXTS);

/** Extensions recognised for book patterns */
export const BOOK_EXTENSIONS = Array.from(EBOOK_EXTS);

/** Extensions recognised for generic document patterns */
export const DOC_EXTENSIONS = Array.from(DOCUMENT_EXTS);

// ── Category map for organizer / library-stats ─────────────────────

export interface SortCategory {
  folder: string;
  extensions: Set<string>;
}

export const SORT_CATEGORIES: SortCategory[] = [
  { folder: "Images", extensions: PHOTO_EXTS },
  { folder: "Videos", extensions: VIDEO_EXTS },
  { folder: "Audio", extensions: AUDIO_EXTS },
  { folder: "Documents", extensions: DOCUMENT_EXTS },
  { folder: "eBooks", extensions: EBOOK_EXTS },
  { folder: "Installers", extensions: INSTALLER_EXTS },
  { folder: "Archives", extensions: ARCHIVE_EXTS },
  { folder: "Subtitles", extensions: SUBTITLE_EXTS },
  { folder: "Code", extensions: CODE_EXTS }
];

/** Quick lookup: category label → set of extensions (for stats) */
export const CATEGORY_MAP: Record<string, Set<string>> = Object.fromEntries(
  SORT_CATEGORIES.map(c => [c.folder, c.extensions])
);
// Add NFO as a special display category for stats
CATEGORY_MAP["NFO"] = NFO_EXTS;

// ── TV episode regexes ─────────────────────────────────────────────

/** Standard SxxExx / NxNN and related TV patterns for detection */
export const TV_EPISODE_RE =
  /[Ss]\d{1,2}[Ee]\d{1,2}|[Ss]eason\s*\d|[Ee]pisode\s*\d|\b\d{1,2}x\d{2}\b/;

// ── Filesystem helpers ─────────────────────────────────────────────

import { existsSync, accessSync, constants as fsConstants } from "fs";

export interface PathValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a path exists, is a directory, and is readable.
 * Returns `{ valid: true }` on success, or `{ valid: false, reason }` on failure.
 */
export function validateFolderPath(folderPath: string): PathValidation {
  if (!folderPath || folderPath.trim() === "") {
    return { valid: false, reason: "No folder path provided." };
  }

  if (!existsSync(folderPath)) {
    return { valid: false, reason: `Path does not exist: ${folderPath}` };
  }

  try {
    accessSync(folderPath, fsConstants.R_OK);
  } catch {
    return { valid: false, reason: `Path is not readable: ${folderPath}` };
  }

  return { valid: true };
}
