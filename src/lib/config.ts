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

/**
 * Comic/manga archive extensions.
 * CBZ/CBR are shared with EBOOK_EXTS; these are the full comic set including
 * CB7 and CBT (7-zip and tar comic archives) used by Kavita/ComicRack.
 */
export const COMIC_EXTS = new Set([
  ".cbz", ".cbr", ".cb7", ".cbt", ".pdf", ".epub"
]);

/**
 * Podcast / audio-show extensions.
 * Subset of AUDIO_EXTS plus video podcasts (mp4).
 */
export const PODCAST_EXTS = new Set([
  ".mp3", ".m4a", ".ogg", ".opus", ".aac", ".flac", ".wav",
  ".mp4", ".m4v", ".webm"
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

export const ROM_EXTS = new Set([
  // Nintendo
  ".nes", ".fds",           // NES / Famicom Disk System
  ".sfc", ".smc",           // SNES / Super Famicom
  ".gb", ".gbc", ".gba",    // Game Boy / Color / Advance
  ".nds", ".3ds", ".cia",   // DS / 3DS
  ".n64", ".z64", ".v64",   // N64
  ".xci", ".nsp",           // Switch
  ".wbfs", ".wad", ".gcm", ".rvz", // Wii / GameCube
  // Sega
  ".gen",                   // Genesis / Mega Drive
  ".sms",                   // Master System
  ".gg",                    // Game Gear
  ".32x",                   // 32X
  ".cdi",                   // Dreamcast
  // Sony
  ".pbp",                   // PSP
  // NEC
  ".pce",                   // TurboGrafx-16 / PC Engine
  // Atari
  ".a26", ".a78",           // Atari 2600 / 7800
  // Compressed disc images (commonly used for disc-based ROMs)
  ".chd", ".cue"
]);

// ── Naming pattern extension lists (for renamer / patterns.ts) ─────

/** Regex to strip release group tags from parsed episode titles */
export const RELEASE_TAG_RE = /\b(720p|1080p|2160p|4K|BluRay|WEB-?DL|HDTV|x264|x265|HEVC|AAC|DTS)\b.*/i;

/**
 * Regex to extract resolution from a filename (e.g. "1080p", "2160p", "4K", "720p").
 * Captures the resolution token itself.
 */
export const RESOLUTION_RE = /\b(720p|1080p|2160p|4K|480p|576p)\b/i;

/** Human-readable labels for common resolutions (Jellyfin multi-version convention) */
export const RESOLUTION_LABELS: Record<string, string> = {
  "480p": "480p",
  "576p": "576p",
  "720p": "720p",
  "1080p": "1080p",
  "2160p": "4K",
  "4k": "4K",
  "4K": "4K"
};

/**
 * Regex to capture source/quality tags from filenames.
 * Matches: BluRay, Bluray, WEB-DL, WEBDL, HDTV, REMUX, BDRip, BRRip, DVDRip, WEBRip.
 */
export const SOURCE_TAG_RE = /\b(Blu-?Ray|REMUX|WEB-?DL|WEB-?Rip|HDTV|BD-?Rip|BR-?Rip|DVD-?Rip|HDRip)\b/i;

/** Normalised labels for source tags */
export const SOURCE_LABELS: Record<string, string> = {
  "bluray":  "Bluray",
  "blu-ray": "Bluray",
  "remux":   "Remux",
  "web-dl":  "WEBDL",
  "webdl":   "WEBDL",
  "web-rip": "WEBRip",
  "webrip":  "WEBRip",
  "hdtv":    "HDTV",
  "bdrip":   "BDRip",
  "bd-rip":  "BDRip",
  "brrip":   "BDRip",
  "br-rip":  "BDRip",
  "dvdrip":  "DVDRip",
  "dvd-rip": "DVDRip",
  "hdrip":   "HDRip"
};

/** Regex to detect HDR / Dolby Vision / HDR10+ dynamic range tags */
export const HDR_TAG_RE = /\b(HDR10\+|HDR10|HDR|DV|DoVi|Dolby[\s.]?Vision)(?=[.\s\-)]|$)/i;

/** Normalised labels for HDR tags */
export const HDR_LABELS: Record<string, string> = {
  "hdr":            "HDR",
  "hdr10":          "HDR10",
  "hdr10+":         "HDR10+",
  "dv":             "DV",
  "dovi":           "DV",
  "dolby vision":   "DV",
  "dolby.vision":   "DV",
  "dolbyvision":    "DV"
};

// ── Compression / Transcode (experimental) ─────────────────────────

/**
 * ROM extensions that compress well in standard zip/7z archives.
 * These are typically cartridge-based ROM formats with raw data.
 */
export const COMPRESSIBLE_ROM_EXTS = new Set([
  ".nes", ".fds", ".sfc", ".smc", ".gb", ".gbc", ".gba",
  ".nds", ".n64", ".z64", ".v64",
  ".gen", ".sms", ".gg", ".32x", ".pce",
  ".a26", ".a78"
]);

/**
 * Disc-based ROM extensions best compressed with CHD (MAME Compressed Hunks of Data)
 * or similar disc-aware formats. Standard zip gives poor results on these.
 */
export const DISC_ROM_EXTS = new Set([
  ".iso", ".bin", ".img", ".cue", ".gdi", ".cdi",
  ".wbfs", ".gcm", ".rvz", ".wad",
  ".pbp"
]);

/** Video transcode presets for experimental compression (FFmpeg-based) */
export interface TranscodePreset {
  /** Human-readable name */
  label: string;
  /** Short description */
  description: string;
  /** FFmpeg output options (appended after input) */
  ffmpegArgs: string[];
  /** Expected output extension */
  outputExt: string;
}

export const TRANSCODE_PRESETS: Record<string, TranscodePreset> = {
  hevc_medium: {
    label: "HEVC Medium (CRF 22)",
    description: "Good quality, ~50% size reduction. Widely compatible.",
    ffmpegArgs: ["-c:v", "libx265", "-crf", "22", "-preset", "medium", "-c:a", "copy"],
    outputExt: ".mkv"
  },
  hevc_small: {
    label: "HEVC Smaller (CRF 26)",
    description: "Smaller files, slight quality loss. Good for archiving.",
    ffmpegArgs: ["-c:v", "libx265", "-crf", "26", "-preset", "medium", "-c:a", "copy"],
    outputExt: ".mkv"
  },
  av1_quality: {
    label: "AV1 Quality (CRF 30)",
    description: "Best compression, very slow. For long-term archiving.",
    ffmpegArgs: ["-c:v", "libsvtav1", "-crf", "30", "-preset", "6", "-c:a", "copy"],
    outputExt: ".mkv"
  },
  copy_mkv: {
    label: "Remux to MKV (no re-encode)",
    description: "Container swap only. Lossless, instant, no quality change.",
    ffmpegArgs: ["-c", "copy"],
    outputExt: ".mkv"
  }
};

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

/** Extensions recognised for comic/manga patterns */
export const COMIC_EXTENSIONS = Array.from(COMIC_EXTS);

/** Extensions recognised for podcast patterns */
export const PODCAST_EXTENSIONS = Array.from(PODCAST_EXTS);

/**
 * Extensions for YouTube / video-download archive patterns.
 * Includes video and audio-only downloads.
 */
export const YOUTUBE_EXTENSIONS = [
  ...Array.from(VIDEO_EXTS),
  ...Array.from(AUDIO_EXTS)
];

/** Extensions recognised for emulation ROM patterns */
export const ROM_EXTENSIONS = Array.from(ROM_EXTS);

/** Map ROM file extensions to human-readable platform names for folder organization */
export const PLATFORM_MAP: Record<string, string> = {
  ".nes": "NES", ".fds": "NES",
  ".sfc": "SNES", ".smc": "SNES",
  ".gb": "Game Boy", ".gbc": "Game Boy Color", ".gba": "Game Boy Advance",
  ".nds": "Nintendo DS", ".3ds": "Nintendo 3DS", ".cia": "Nintendo 3DS",
  ".n64": "Nintendo 64", ".z64": "Nintendo 64", ".v64": "Nintendo 64",
  ".xci": "Nintendo Switch", ".nsp": "Nintendo Switch",
  ".wbfs": "Wii", ".wad": "Wii", ".gcm": "GameCube", ".rvz": "GameCube",
  ".gen": "Sega Genesis", ".sms": "Sega Master System",
  ".gg": "Sega Game Gear", ".32x": "Sega 32X", ".cdi": "Sega Dreamcast",
  ".pbp": "PSP",
  ".pce": "TurboGrafx-16",
  ".a26": "Atari 2600", ".a78": "Atari 7800",
  ".chd": "Disc Games", ".cue": "Disc Games"
};

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
  { folder: "Comics", extensions: COMIC_EXTS },
  { folder: "Installers", extensions: INSTALLER_EXTS },
  { folder: "Archives", extensions: ARCHIVE_EXTS },
  { folder: "ROMs", extensions: ROM_EXTS },
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

/**
 * Regex to detect YouTube video IDs in yt-dlp naming patterns.
 * yt-dlp default: "Title [VIDEO_ID].ext"
 * Captures the 11-character ID inside square brackets.
 */
export const YOUTUBE_ID_RE = /\[([A-Za-z0-9_-]{11})\](?:\.[^.]+)?$/;

/**
 * Regex to detect absolute episode numbering (common in anime).
 * Matches patterns like " - 001", " - 01", "E001", "EP01", "Episode 01".
 * Group 1 captures the number.
 */
export const ABSOLUTE_EPISODE_RE = /(?:\s-\s|[Ee][Pp]?)(\d{2,4})(?:[.\s_-]|$)/;

/**
 * Regex to detect comic/manga volume numbering.
 * Matches Vol 01, Volume 01, v01, Vol.01.
 * Group 1 captures the number.
 */
export const COMIC_VOLUME_RE = /\b[Vv](?:ol(?:ume)?)?\.?\s*(\d{1,3})\b/;

/**
 * Regex to detect comic/manga chapter numbering.
 * Matches Ch 01, Chapter 01, c01, Ch.01, #01.
 * Group 1 captures the number.
 */
export const COMIC_CHAPTER_RE = /(?:[Cc](?:h(?:apter)?)?\.?\s*|#)(\d{1,4})\b/;

/**
 * Regex to detect fansub group tags at the start of anime filenames.
 * Matches [SubGroup], [Fansub-Group], etc.
 */
export const FANSUB_TAG_RE = /^\[.+?\]/;

/** Regex to strip ROM scene/dump tags like [!], [b], [h1], [o2] from filenames */
export const ROM_TAG_RE = /\s*\[[\w!]+\]/g;

/** Regex to extract the first parenthesised region tag from a ROM filename */
export const ROM_REGION_RE = /\(([^)]+)\)/;

// ── Filesystem helpers ─────────────────────────────────────────────

import { existsSync, accessSync, statSync, constants as fsConstants } from "fs";

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
    const stat = statSync(folderPath);
    if (!stat.isDirectory()) {
      return { valid: false, reason: `Path is not a directory: ${folderPath}` };
    }
  } catch {
    return { valid: false, reason: `Cannot stat path: ${folderPath}` };
  }

  try {
    accessSync(folderPath, fsConstants.R_OK);
  } catch {
    return { valid: false, reason: `Path is not readable: ${folderPath}` };
  }

  return { valid: true };
}
