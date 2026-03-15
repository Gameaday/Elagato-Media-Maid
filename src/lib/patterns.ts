/**
 * Naming pattern definitions for MediaMaid.
 * Each MediaType has a corresponding pattern that formats filenames
 * following a standard convention (Jellyfin/Plex, Photography, Music, etc.).
 *
 * All extension lists are sourced from the centralized config module.
 */

import {
  TV_VIDEO_EXTENSIONS,
  PHOTO_EXTENSIONS,
  MUSIC_EXTENSIONS,
  BOOK_EXTENSIONS,
  DOC_EXTENSIONS,
  ROM_EXTENSIONS,
  PLATFORM_MAP,
  RESOLUTION_LABELS
} from "./config.js";

export enum MediaType {
  JELLYFIN_TV = "jellyfin_tv",
  JELLYFIN_MOVIE = "jellyfin_movie",
  JELLYFIN_MOVIE_VERSION = "jellyfin_movie_version",
  PHOTOGRAPHY = "photography",
  MUSIC = "music",
  BOOKS = "books",
  GENERIC_DOCS = "generic_docs",
  EMULATION_ROMS = "emulation_roms",
  CUSTOM = "custom",
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
  /** ROM platform/console name (auto-detected from extension) */
  platform?: string;
  /** ROM region tag (e.g. "USA", "Japan", "Europe") */
  region?: string;
  /** Video resolution tag (e.g. "1080p", "4K") for multi-version movies */
  resolution?: string;
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
  extensions: TV_VIDEO_EXTENSIONS,
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
  extensions: TV_VIDEO_EXTENSIONS,
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
// Jellyfin Movie Multi-Version Pattern
// Format: "Movie Title (Year) - [Resolution].ext"
// Folder:  "Movie Title (Year)/"
// Jellyfin docs: multiple versions of the same movie stored in one folder.
//   Movie Title (Year)/Movie Title (Year) - [1080p Bluray].mkv
//   Movie Title (Year)/Movie Title (Year) - [2160p 4K].mkv
// ---------------------------------------------------------------------------
export const jellyfinMovieVersionPattern: NamingPattern = {
  mediaType: MediaType.JELLYFIN_MOVIE_VERSION,
  label: "Jellyfin – Movie Multi-Version",
  extensions: TV_VIDEO_EXTENSIONS,
  format(meta) {
    const title = sanitizeFilename(meta.title ?? meta.baseName);
    const year = meta.year ? ` (${meta.year})` : "";
    const raw = meta.resolution?.toLowerCase() ?? "";
    const res = RESOLUTION_LABELS[raw] ?? meta.resolution;
    const tag = res ? ` - [${res}]` : "";
    return `${title}${year}${tag}${meta.ext}`;
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
  extensions: PHOTO_EXTENSIONS,
  format(meta) {
    const date = meta.dateTaken ?? new Date().toISOString().slice(0, 10);
    const loc = meta.location ? `_${sanitizeFilename(meta.location)}` : "";
    const idx = meta.index !== undefined ? `_${pad(meta.index, 3)}` : "";
    return `${date}${loc}${idx}${meta.ext}`;
  }
};

// ---------------------------------------------------------------------------
// Music Pattern (Jellyfin / MusicBrainz-compatible)
// Format: "01 - Artist - Song Title.ext"
// Folder:  "Artist/Album (Year)/"
// Jellyfin docs: Artist/Album (Year)/01 - Song Title.ext
// ---------------------------------------------------------------------------
export const musicPattern: NamingPattern = {
  mediaType: MediaType.MUSIC,
  label: "Music – Track# Artist Song",
  extensions: MUSIC_EXTENSIONS,
  format(meta) {
    const track = meta.trackNumber !== undefined ? `${pad(meta.trackNumber)} - ` : "";
    const artist = sanitizeFilename(meta.artist ?? "Unknown Artist");
    const song = sanitizeFilename(meta.songTitle ?? meta.title ?? meta.baseName);
    return `${track}${artist} - ${song}${meta.ext}`;
  },
  folderPath(meta) {
    const artist = sanitizeFilename(meta.artist ?? "Unknown Artist");
    const album = sanitizeFilename(meta.album ?? "Unknown Album");
    const year = meta.year ? ` (${meta.year})` : "";
    return `${artist}/${album}${year}`;
  }
};

// ---------------------------------------------------------------------------
// Books Pattern (Jellyfin / Calibre-compatible)
// Format: "Author - Title (Year).ext"
// Folder:  "Author/"
// Jellyfin docs: Author/Title (Year).ext or Author Name/Book Title (Year).epub
// ---------------------------------------------------------------------------
export const booksPattern: NamingPattern = {
  mediaType: MediaType.BOOKS,
  label: "Books / eBooks – Author Title",
  extensions: BOOK_EXTENSIONS,
  format(meta) {
    const author = sanitizeFilename(meta.artist ?? meta.title ?? "Unknown Author");
    const bookTitle = sanitizeFilename(meta.songTitle ?? meta.baseName);
    const year = meta.year ? ` (${meta.year})` : "";
    return `${author} - ${bookTitle}${year}${meta.ext}`;
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
  extensions: DOC_EXTENSIONS,
  format(meta) {
    const date = meta.dateTaken ?? new Date().toISOString().slice(0, 10);
    const name = sanitizeFilename(meta.baseName);
    return `${date}_${name}${meta.ext}`;
  }
};

// ---------------------------------------------------------------------------
// Emulation ROMs Pattern
// Format: "Game Name (Region).ext"
// Folder:  "Platform/"   (auto-detected from file extension)
// ---------------------------------------------------------------------------
export const emulationRomsPattern: NamingPattern = {
  mediaType: MediaType.EMULATION_ROMS,
  label: "Emulation ROMs – By Platform",
  extensions: ROM_EXTENSIONS,
  format(meta) {
    const title = sanitizeFilename(meta.title ?? meta.baseName);
    const region = meta.region ? ` (${sanitizeFilename(meta.region)})` : "";
    return `${title}${region}${meta.ext}`;
  },
  folderPath(meta) {
    const platform = meta.platform ?? PLATFORM_MAP[meta.ext.toLowerCase()] ?? "Other";
    return sanitizeFilename(platform);
  }
};

/** All available patterns, ordered for UI display */
export const ALL_PATTERNS: NamingPattern[] = [
  jellyfinTvPattern,
  jellyfinMoviePattern,
  jellyfinMovieVersionPattern,
  photographyPattern,
  musicPattern,
  booksPattern,
  genericDocsPattern,
  emulationRomsPattern
];

/** Look up a pattern by MediaType */
export function getPattern(mediaType: MediaType): NamingPattern | undefined {
  return ALL_PATTERNS.find(p => p.mediaType === mediaType);
}

// ---------------------------------------------------------------------------
// Custom Template Pattern
// Tokens: {title}, {season}, {episode}, {episodeTitle}, {year}, {artist},
//         {track}, {song}, {date}, {location}, {index}, {ext}, {baseName},
//         {platform}, {region}, {resolution}, {album}
// ---------------------------------------------------------------------------

/**
 * Replace template tokens with values from metadata.
 * Unknown tokens are left as-is. Empty optional values produce "".
 */
export function applyTemplate(template: string, meta: FileMetadata): string {
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    switch (token) {
      case "title":        return sanitizeFilename(meta.title ?? meta.baseName);
      case "season":       return meta.season !== undefined ? pad(meta.season) : "";
      case "episode":      return meta.episode !== undefined ? pad(meta.episode) : "";
      case "episodeTitle": return meta.episodeTitle ? sanitizeFilename(meta.episodeTitle) : "";
      case "year":         return meta.year !== undefined ? String(meta.year) : "";
      case "artist":       return meta.artist ? sanitizeFilename(meta.artist) : "";
      case "track":        return meta.trackNumber !== undefined ? pad(meta.trackNumber) : "";
      case "song":         return meta.songTitle ? sanitizeFilename(meta.songTitle) : "";
      case "date":         return meta.dateTaken ?? "";
      case "location":     return meta.location ? sanitizeFilename(meta.location) : "";
      case "index":        return meta.index !== undefined ? pad(meta.index, 3) : "";
      case "ext":          return meta.ext;
      case "baseName":     return sanitizeFilename(meta.baseName);
      case "platform":     return meta.platform ? sanitizeFilename(meta.platform) : "";
      case "region":       return meta.region ? sanitizeFilename(meta.region) : "";
      case "resolution":   return meta.resolution ?? "";
      case "album":        return meta.album ? sanitizeFilename(meta.album) : "";
      default:             return `{${token}}`;
    }
  });
}

/** Default custom format template */
export const DEFAULT_CUSTOM_TEMPLATE = "{title} - S{season}E{episode}{ext}";

/**
 * Create a NamingPattern from a user-defined template string.
 * Accepts all common media file extensions so it works with any content type.
 */
export function createCustomPattern(template: string): NamingPattern {
  const allExtensions = [
    ...TV_VIDEO_EXTENSIONS,
    ...PHOTO_EXTENSIONS,
    ...MUSIC_EXTENSIONS,
    ...BOOK_EXTENSIONS,
    ...DOC_EXTENSIONS,
    ...ROM_EXTENSIONS
  ];
  // Deduplicate
  const extensions = [...new Set(allExtensions)];

  return {
    mediaType: MediaType.CUSTOM,
    label: "Custom Template",
    extensions,
    format(meta) {
      return applyTemplate(template, meta);
    }
  };
}
