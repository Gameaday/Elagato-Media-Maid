/**
 * Naming pattern definitions for MediaMaid.
 * Each MediaType has a corresponding pattern that formats filenames
 * following a standard convention (Jellyfin/Plex, Photography, Music, etc.).
 */

export enum MediaType {
  JELLYFIN_TV = "jellyfin_tv",
  JELLYFIN_MOVIE = "jellyfin_movie",
  PHOTOGRAPHY = "photography",
  MUSIC = "music",
  BOOKS = "books",
  GENERIC_DOCS = "generic_docs",
  UNKNOWN = "unknown"
}

export interface FileMetadata {
  /** Original filename without extension */
  baseName: string;
  /** File extension including the dot (e.g. ".mkv") */
  ext: string;
  /** Full original path */
  originalPath: string;
  /** Show/artist/album name */
  title?: string;
  /** Season number (TV shows) */
  season?: number;
  /** Episode number (TV shows) */
  episode?: number;
  /** Episode title (TV shows) */
  episodeTitle?: string;
  /** Release year */
  year?: number;
  /** Track number (music) */
  trackNumber?: number;
  /** Artist name (music) */
  artist?: string;
  /** Album name (music) */
  album?: string;
  /** Song title (music) */
  songTitle?: string;
  /** Date taken in YYYY-MM-DD format (photos) */
  dateTaken?: string;
  /** Location string (photos) */
  location?: string;
  /** Index/counter for disambiguation */
  index?: number;
}

export interface NamingPattern {
  mediaType: MediaType;
  /** Human-readable name for UI display */
  label: string;
  /** File extensions this pattern targets */
  extensions: string[];
  /** Format a filename from metadata */
  format(metadata: FileMetadata): string;
  /** Optional: generate the subfolder path for this file */
  folderPath?(metadata: FileMetadata): string;
}

/**
 * Pad a number with leading zeros to a minimum width.
 */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * Sanitize a string for use in filenames by removing/replacing problematic characters.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Jellyfin / Plex TV Show Pattern
// Format: "Show Name - S01E01 - Episode Title.ext"
// Folder:  "Show Name/Season 01/"
// ---------------------------------------------------------------------------
export const jellyfinTvPattern: NamingPattern = {
  mediaType: MediaType.JELLYFIN_TV,
  label: "Jellyfin / Plex – TV Show",
  extensions: [".mkv", ".mp4", ".avi", ".m4v", ".ts", ".mov", ".wmv", ".webm"],
  format(meta) {
    const show = sanitizeFilename(meta.title ?? meta.baseName);
    const s = pad(meta.season ?? 1);
    const e = pad(meta.episode ?? 1);
    const ep = meta.episodeTitle ? ` - ${sanitizeFilename(meta.episodeTitle)}` : "";
    return `${show} - S${s}E${e}${ep}${meta.ext}`;
  },
  folderPath(meta) {
    const show = sanitizeFilename(meta.title ?? meta.baseName);
    const s = pad(meta.season ?? 1);
    return `${show}/Season ${s}`;
  }
};

// ---------------------------------------------------------------------------
// Jellyfin / Plex Movie Pattern
// Format: "Movie Title (Year).ext"
// Folder:  "Movie Title (Year)/"
// ---------------------------------------------------------------------------
export const jellyfinMoviePattern: NamingPattern = {
  mediaType: MediaType.JELLYFIN_MOVIE,
  label: "Jellyfin / Plex – Movie",
  extensions: [".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".webm"],
  format(meta) {
    const title = sanitizeFilename(meta.title ?? meta.baseName);
    const year = meta.year ? ` (${meta.year})` : "";
    return `${title}${year}${meta.ext}`;
  },
  folderPath(meta) {
    const title = sanitizeFilename(meta.title ?? meta.baseName);
    const year = meta.year ? ` (${meta.year})` : "";
    return `${title}${year}`;
  }
};

// ---------------------------------------------------------------------------
// Photography Pattern
// Format: "YYYY-MM-DD_Location_001.ext"
// ---------------------------------------------------------------------------
export const photographyPattern: NamingPattern = {
  mediaType: MediaType.PHOTOGRAPHY,
  label: "Photography – Date + Location",
  extensions: [".jpg", ".jpeg", ".png", ".heic", ".raw", ".arw", ".cr2", ".nef", ".tiff", ".tif", ".webp"],
  format(meta) {
    const date = meta.dateTaken ?? new Date().toISOString().slice(0, 10);
    const loc = meta.location ? `_${sanitizeFilename(meta.location)}` : "";
    const idx = meta.index !== undefined ? `_${pad(meta.index, 3)}` : "";
    return `${date}${loc}${idx}${meta.ext}`;
  }
};

// ---------------------------------------------------------------------------
// Music Pattern
// Format: "01 - Artist - Song Title.ext"
// Folder:  "Artist/Album/"
// ---------------------------------------------------------------------------
export const musicPattern: NamingPattern = {
  mediaType: MediaType.MUSIC,
  label: "Music – Track# Artist Song",
  extensions: [".flac", ".mp3", ".aac", ".ogg", ".opus", ".wav", ".m4a", ".wma", ".alac"],
  format(meta) {
    const track = meta.trackNumber !== undefined ? `${pad(meta.trackNumber)} - ` : "";
    const artist = sanitizeFilename(meta.artist ?? "Unknown Artist");
    const song = sanitizeFilename(meta.songTitle ?? meta.title ?? meta.baseName);
    return `${track}${artist} - ${song}${meta.ext}`;
  },
  folderPath(meta) {
    const artist = sanitizeFilename(meta.artist ?? "Unknown Artist");
    const album = sanitizeFilename(meta.album ?? "Unknown Album");
    return `${artist}/${album}`;
  }
};

// ---------------------------------------------------------------------------
// Books Pattern
// Format: "Author - Title.ext"
// ---------------------------------------------------------------------------
export const booksPattern: NamingPattern = {
  mediaType: MediaType.BOOKS,
  label: "Books / eBooks – Author Title",
  extensions: [".epub", ".mobi", ".azw", ".azw3", ".pdf", ".cbz", ".cbr"],
  format(meta) {
    const author = sanitizeFilename(meta.artist ?? meta.title ?? "Unknown Author");
    const bookTitle = sanitizeFilename(meta.songTitle ?? meta.baseName);
    return `${author} - ${bookTitle}${meta.ext}`;
  },
  folderPath(meta) {
    return sanitizeFilename(meta.artist ?? "Unknown Author");
  }
};

// ---------------------------------------------------------------------------
// Generic Documents Pattern
// Format: "YYYY-MM-DD_OriginalName.ext"
// ---------------------------------------------------------------------------
export const genericDocsPattern: NamingPattern = {
  mediaType: MediaType.GENERIC_DOCS,
  label: "Documents – Date Prefixed",
  extensions: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv"],
  format(meta) {
    const date = meta.dateTaken ?? new Date().toISOString().slice(0, 10);
    const name = sanitizeFilename(meta.baseName);
    return `${date}_${name}${meta.ext}`;
  }
};

/** All available patterns, ordered for UI display */
export const ALL_PATTERNS: NamingPattern[] = [
  jellyfinTvPattern,
  jellyfinMoviePattern,
  photographyPattern,
  musicPattern,
  booksPattern,
  genericDocsPattern
];

/** Look up a pattern by MediaType */
export function getPattern(mediaType: MediaType): NamingPattern | undefined {
  return ALL_PATTERNS.find(p => p.mediaType === mediaType);
}
