/**
 * Content-type detector for MediaMaid.
 *
 * Analyzes a folder's file extensions, counts, and naming patterns to guess
 * the dominant media type so the correct renaming pattern can be applied.
 */

import { readdirSync, statSync } from "fs";
import { extname, join } from "path";
import { MediaType } from "./patterns.js";

export interface DetectionResult {
  mediaType: MediaType;
  /** Confidence score from 0 (no idea) to 1 (certain) */
  confidence: number;
  /** Human-readable explanation of the detection */
  reason: string;
  /** Extension counts found in the folder */
  extensionCounts: Record<string, number>;
}

// Extension sets for each media type
const TV_VIDEO_EXTS = new Set([".mkv", ".mp4", ".avi", ".m4v", ".ts", ".mov", ".wmv", ".webm"]);
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".raw", ".arw", ".cr2", ".nef", ".tiff", ".tif", ".webp"]);
const MUSIC_EXTS = new Set([".flac", ".mp3", ".aac", ".ogg", ".opus", ".wav", ".m4a", ".wma", ".alac"]);
const BOOK_EXTS = new Set([".epub", ".mobi", ".azw", ".azw3", ".cbz", ".cbr"]);
const DOC_EXTS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv"]);

/** Regex patterns that suggest TV episode filenames */
const TV_EPISODE_RE = /[Ss]\d{1,2}[Ee]\d{1,2}|[Ss]eason\s*\d|[Ee]pisode\s*\d|\b\d{1,2}x\d{2}\b/;

/**
 * Recursively collect file extensions from a directory (up to maxDepth levels deep).
 */
function collectExtensions(dir: string, depth = 0, maxDepth = 1): Record<string, number> {
  const counts: Record<string, number> = {};
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return counts;
  }

  for (const name of entries) {
    const fullPath = join(dir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory() && depth < maxDepth) {
      const sub = collectExtensions(fullPath, depth + 1, maxDepth);
      for (const [ext, count] of Object.entries(sub)) {
        counts[ext] = (counts[ext] ?? 0) + count;
      }
    } else if (stat.isFile()) {
      const ext = extname(name).toLowerCase();
      if (ext) {
        counts[ext] = (counts[ext] ?? 0) + 1;
      }
    }
  }

  return counts;
}

/**
 * Count how many files match a given extension set.
 */
function countMatching(extCounts: Record<string, number>, extSet: Set<string>): number {
  return Object.entries(extCounts)
    .filter(([ext]) => extSet.has(ext))
    .reduce((acc, [, n]) => acc + n, 0);
}

/**
 * Check how many filenames in the directory look like TV episode patterns.
 */
function countTvPatternMatches(dir: string): number {
  let matches = 0;
  try {
    const entries = readdirSync(dir);
    for (const name of entries) {
      if (TV_EPISODE_RE.test(name)) matches++;
    }
  } catch {
    // ignore read errors
  }
  return matches;
}

/**
 * Check for the presence of NFO companion files, which strongly indicate
 * Kodi/Jellyfin-managed media.
 */
function hasNfoFiles(dir: string): boolean {
  try {
    const entries = readdirSync(dir);
    return entries.some(n => n.toLowerCase().endsWith(".nfo"));
  } catch {
    return false;
  }
}

/**
 * Detect the dominant media type in the given directory.
 */
export function detectMediaType(folderPath: string): DetectionResult {
  const extCounts = collectExtensions(folderPath);
  const totalFiles = Object.values(extCounts).reduce((a, b) => a + b, 0);

  if (totalFiles === 0) {
    return {
      mediaType: MediaType.UNKNOWN,
      confidence: 0,
      reason: "No files found in the folder.",
      extensionCounts: extCounts
    };
  }

  const videoCount = countMatching(extCounts, TV_VIDEO_EXTS);
  const photoCount = countMatching(extCounts, PHOTO_EXTS);
  const musicCount = countMatching(extCounts, MUSIC_EXTS);
  const bookCount = countMatching(extCounts, BOOK_EXTS);
  const docCount = countMatching(extCounts, DOC_EXTS);
  const tvPatternCount = countTvPatternMatches(folderPath);
  const nfoPresent = hasNfoFiles(folderPath);

  // Score each type
  const scores: Array<{ type: MediaType; score: number; reason: string }> = [
    {
      type: MediaType.JELLYFIN_TV,
      // boost if TV episode patterns detected in filenames or NFO files exist
      score: videoCount + tvPatternCount * 2 + (nfoPresent ? 3 : 0),
      reason: `${videoCount} video file(s), ${tvPatternCount} TV-pattern filename(s)${nfoPresent ? ", NFO files detected" : ""}`
    },
    {
      type: MediaType.PHOTOGRAPHY,
      score: photoCount,
      reason: `${photoCount} photo file(s)`
    },
    {
      type: MediaType.MUSIC,
      score: musicCount,
      reason: `${musicCount} music file(s)`
    },
    {
      type: MediaType.BOOKS,
      score: bookCount,
      reason: `${bookCount} ebook file(s)`
    },
    {
      type: MediaType.GENERIC_DOCS,
      score: docCount,
      reason: `${docCount} document file(s)`
    }
  ];

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];

  if (top.score === 0) {
    return {
      mediaType: MediaType.UNKNOWN,
      confidence: 0,
      reason: "Could not identify a dominant media type.",
      extensionCounts: extCounts
    };
  }

  // If videos are detected but no TV patterns, lean toward movie
  let finalType = top.type;
  if (top.type === MediaType.JELLYFIN_TV && tvPatternCount === 0 && videoCount <= 3) {
    finalType = MediaType.JELLYFIN_MOVIE;
  }

  const confidence = Math.min(top.score / totalFiles, 1);

  return {
    mediaType: finalType,
    confidence,
    reason: top.reason,
    extensionCounts: extCounts
  };
}
