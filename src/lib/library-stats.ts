/**
 * Library statistics calculator for MediaMaid.
 *
 * Scans a media library and produces aggregate statistics including
 * file counts by type, total size, and naming health scores.
 * Designed for display on the Stream Deck+ touchscreen.
 *
 * Uses the centralized extension registry from config.ts.
 */

import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import { detectMediaType } from "./detector.js";
import type { MediaType } from "./patterns.js";
import { CATEGORY_MAP, DEFAULT_MAX_DEPTH, validateFolderPath } from "./config.js";

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

// CATEGORY_MAP imported from config.ts

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
async function gatherStats(dir: string, maxDepth = DEFAULT_MAX_DEPTH, depth = 0): Promise<{ files: number; bytes: number; categories: Record<string, number> }> {
  const result = { files: 0, bytes: 0, categories: {} as Record<string, number> };

  if (depth > maxDepth) return result;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return result;
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const fullPath = join(dir, name);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory()) {
      const sub = await gatherStats(fullPath, maxDepth, depth + 1);
      result.files += sub.files;
      result.bytes += sub.bytes;
      for (const [cat, count] of Object.entries(sub.categories)) {
        result.categories[cat] = (result.categories[cat] ?? 0) + count;
      }
    } else if (fileStat.isFile()) {
      result.files++;
      result.bytes += fileStat.size;

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
export async function calculateLibraryStats(libraryRoot: string): Promise<LibraryStats> {
  const pathCheck = validateFolderPath(libraryRoot);
  if (!pathCheck.valid) {
    return {
      totalFiles: 0,
      totalSizeBytes: 0,
      totalSizeFormatted: "0 B",
      categoryCounts: {},
      detectedType: "unknown" as MediaType,
      confidence: 0,
      displayStats: [{ label: "Error", value: pathCheck.reason ?? "Invalid path" }]
    };
  }

  const raw = await gatherStats(libraryRoot);
  const detection = await detectMediaType(libraryRoot);

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
