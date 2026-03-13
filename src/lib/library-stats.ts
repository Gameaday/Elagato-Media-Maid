/**
 * Library statistics calculator for MediaMaid.
 *
 * Scans a media library and produces aggregate statistics including
 * file counts by type, total size, and naming health scores.
 * Designed for display on the Stream Deck+ touchscreen.
 */

import { readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { detectMediaType } from "./detector.js";
import type { MediaType } from "./patterns.js";

export interface LibraryStat {
  /** Stat label for display */
  label: string;
  /** Stat value for display */
  value: string;
}

export interface LibraryStats {
  /** Total number of files in the library */
  totalFiles: number;
  /** Total size in bytes */
  totalSizeBytes: number;
  /** Human-readable total size */
  totalSizeFormatted: string;
  /** File counts grouped by category */
  categoryCounts: Record<string, number>;
  /** Detected primary media type */
  detectedType: MediaType;
  /** Detection confidence */
  confidence: number;
  /** Array of stats formatted for display cycling */
  displayStats: LibraryStat[];
}

const CATEGORY_MAP: Record<string, Set<string>> = {
  "Video": new Set([".mkv", ".mp4", ".avi", ".m4v", ".ts", ".mov", ".wmv", ".webm", ".flv", ".mpg", ".mpeg"]),
  "Audio": new Set([".flac", ".mp3", ".aac", ".ogg", ".opus", ".wav", ".m4a", ".wma", ".alac"]),
  "Photo": new Set([".jpg", ".jpeg", ".png", ".heic", ".raw", ".arw", ".cr2", ".nef", ".tiff", ".tif", ".webp", ".gif", ".bmp", ".svg"]),
  "Book": new Set([".epub", ".mobi", ".azw", ".azw3", ".cbz", ".cbr"]),
  "Doc": new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv", ".rtf"]),
  "NFO": new Set([".nfo"])
};

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Recursively gather file stats from a directory.
 */
function gatherStats(dir: string, maxDepth = 5, depth = 0): { files: number; bytes: number; categories: Record<string, number> } {
  const result = { files: 0, bytes: 0, categories: {} as Record<string, number> };

  if (depth > maxDepth) return result;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const fullPath = join(dir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const sub = gatherStats(fullPath, maxDepth, depth + 1);
      result.files += sub.files;
      result.bytes += sub.bytes;
      for (const [cat, count] of Object.entries(sub.categories)) {
        result.categories[cat] = (result.categories[cat] ?? 0) + count;
      }
    } else if (stat.isFile()) {
      result.files++;
      result.bytes += stat.size;

      const ext = extname(name).toLowerCase();
      let category = "Other";
      for (const [cat, exts] of Object.entries(CATEGORY_MAP)) {
        if (exts.has(ext)) {
          category = cat;
          break;
        }
      }
      result.categories[category] = (result.categories[category] ?? 0) + 1;
    }
  }

  return result;
}

/**
 * Calculate library statistics for a given directory.
 */
export function calculateLibraryStats(libraryRoot: string): LibraryStats {
  const raw = gatherStats(libraryRoot);
  const detection = detectMediaType(libraryRoot);

  const displayStats: LibraryStat[] = [
    { label: "Total Files", value: String(raw.files) },
    { label: "Total Size", value: formatBytes(raw.bytes) },
    { label: "Media Type", value: detection.mediaType.replace(/_/g, " ") }
  ];

  // Add non-zero category counts
  for (const [cat, count] of Object.entries(raw.categories).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      displayStats.push({ label: cat, value: String(count) });
    }
  }

  displayStats.push({
    label: "Confidence",
    value: `${Math.round(detection.confidence * 100)}%`
  });

  return {
    totalFiles: raw.files,
    totalSizeBytes: raw.bytes,
    totalSizeFormatted: formatBytes(raw.bytes),
    categoryCounts: raw.categories,
    detectedType: detection.mediaType,
    confidence: detection.confidence,
    displayStats
  };
}
