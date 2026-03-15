/**
 * Content-type detector for MediaMaid.
 *
 * Analyzes a folder's file extensions, counts, and naming patterns to guess
 * the dominant media type so the correct renaming pattern can be applied.
 */

import { readdir, stat } from "fs/promises";
import { extname, join } from "path";
import { MediaType } from "./patterns.js";
import {
  VIDEO_EXTS,
  PHOTO_EXTS,
  AUDIO_EXTS,
  EBOOK_EXTS,
  DOCUMENT_EXTS,
  ROM_EXTS,
  COMIC_EXTS,
  PODCAST_EXTS,
  TV_EPISODE_RE,
  RESOLUTION_RE,
  YOUTUBE_ID_RE,
  ABSOLUTE_EPISODE_RE,
  FANSUB_TAG_RE,
  DATE_FILENAME_RE,
  COMIC_VOLUME_RE,
  COMIC_CHAPTER_RE,
  DETECTION_MAX_DEPTH,
  validateFolderPath
} from "./config.js";

export interface DetectionResult {
  mediaType: MediaType;
  /** Confidence score from 0 (no idea) to 1 (certain) */
  confidence: number;
  /** Human-readable explanation of the detection */
  reason: string;
  /** Extension counts found in the folder */
  extensionCounts: Record<string, number>;
}

// Extension sets are imported from config.ts (VIDEO_EXTS, PHOTO_EXTS, etc.)

/**
 * Recursively collect file extensions from a directory (up to maxDepth levels deep).
 */
async function collectExtensions(dir: string, depth = 0, maxDepth = DETECTION_MAX_DEPTH): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return counts;
  }

  for (const name of entries) {
    const fullPath = join(dir, name);
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (fileStat.isDirectory() && depth < maxDepth) {
      const sub = await collectExtensions(fullPath, depth + 1, maxDepth);
      for (const [ext, count] of Object.entries(sub)) {
        counts[ext] = (counts[ext] ?? 0) + count;
      }
    } else if (fileStat.isFile()) {
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
async function countTvPatternMatches(dir: string): Promise<number> {
  let matches = 0;
  try {
    const entries = await readdir(dir);
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
async function hasNfoFiles(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some(n => n.toLowerCase().endsWith(".nfo"));
  } catch {
    return false;
  }
}

/**
 * Count video files that contain resolution tags (e.g. "1080p", "2160p", "4K").
 * Multiple resolution-tagged videos in the same folder suggest a multi-version
 * movie collection.
 */
async function countResolutionTaggedVideos(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      const ext = extname(name).toLowerCase();
      if (VIDEO_EXTS.has(ext) && RESOLUTION_RE.test(name)) {
        count++;
      }
    }
  } catch {
    // ignore read errors
  }
  return count;
}

/**
 * Count files that contain YouTube video IDs (11-character IDs in square brackets).
 * Multiple files with YouTube IDs suggest a yt-dlp download archive.
 */
async function countYoutubeIdFiles(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (YOUTUBE_ID_RE.test(name)) {
        count++;
      }
    }
  } catch {
    // ignore read errors
  }
  return count;
}

/**
 * Count filenames with absolute episode numbering patterns (common in anime).
 * Looks for patterns like " - 001", "[SubGroup]", or absolute numbering
 * without standard SxxExx format.
 */
async function countAnimePatternMatches(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      const ext = extname(name).toLowerCase();
      if (!VIDEO_EXTS.has(ext)) continue;
      // Check for fansub group tags [SubGroup] at start
      const hasFansubTag = FANSUB_TAG_RE.test(name);
      // Check for absolute episode numbering without SxxExx
      const hasAbsoluteEp = ABSOLUTE_EPISODE_RE.test(name) && !TV_EPISODE_RE.test(name);
      if (hasFansubTag || hasAbsoluteEp) {
        count++;
      }
    }
  } catch {
    // ignore read errors
  }
  return count;
}

/**
 * Count audio files that contain date patterns (YYYY-MM-DD) in their filenames.
 * Common for podcast archives organized by episode air date.
 */
async function countPodcastPatternMatches(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      const ext = extname(name).toLowerCase();
      // Must be an audio-capable extension AND have a date in the filename
      if (PODCAST_EXTS.has(ext) && DATE_FILENAME_RE.test(name)) {
        count++;
      }
    }
  } catch {
    // ignore read errors
  }
  return count;
}

/**
 * Count files that look like comic/manga naming (volume/chapter markers).
 * Goes beyond extension matching to verify naming conventions.
 */
async function countComicPatternMatches(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      const ext = extname(name).toLowerCase();
      if (!COMIC_EXTS.has(ext)) continue;
      // Boost score if filename contains volume/chapter markers
      if (COMIC_VOLUME_RE.test(name) || COMIC_CHAPTER_RE.test(name) || /#\d+/.test(name)) {
        count++;
      }
    }
  } catch {
    // ignore read errors
  }
  return count;
}

/**
 * Detect the dominant media type in the given directory.
 */
export async function detectMediaType(folderPath: string): Promise<DetectionResult> {
  const pathCheck = validateFolderPath(folderPath);
  if (!pathCheck.valid) {
    return {
      mediaType: MediaType.UNKNOWN,
      confidence: 0,
      reason: pathCheck.reason ?? "Invalid path.",
      extensionCounts: {}
    };
  }

  const extCounts = await collectExtensions(folderPath);
  const totalFiles = Object.values(extCounts).reduce((a, b) => a + b, 0);

  if (totalFiles === 0) {
    return {
      mediaType: MediaType.UNKNOWN,
      confidence: 0,
      reason: "No files found in the folder.",
      extensionCounts: extCounts
    };
  }

  const videoCount = countMatching(extCounts, VIDEO_EXTS);
  const photoCount = countMatching(extCounts, PHOTO_EXTS);
  const musicCount = countMatching(extCounts, AUDIO_EXTS);
  const docCount = countMatching(extCounts, DOCUMENT_EXTS);
  const romCount = countMatching(extCounts, ROM_EXTS);
  const comicCount = countMatching(extCounts, COMIC_EXTS);

  // CBZ/CBR are shared between EBOOK_EXTS and COMIC_EXTS — subtract the
  // comic-specific extensions from the book count to avoid double-scoring.
  const comicOnlyCount = [".cbz", ".cbr", ".cb7", ".cbt"]
    .reduce((acc, ext) => acc + (extCounts[ext] ?? 0), 0);
  const bookCount = countMatching(extCounts, EBOOK_EXTS) - comicOnlyCount;
  const tvPatternCount = await countTvPatternMatches(folderPath);
  const nfoPresent = await hasNfoFiles(folderPath);
  const resTaggedCount = await countResolutionTaggedVideos(folderPath);
  const youtubeIdCount = await countYoutubeIdFiles(folderPath);
  const animePatternCount = await countAnimePatternMatches(folderPath);
  const podcastPatternCount = await countPodcastPatternMatches(folderPath);
  const comicPatternCount = await countComicPatternMatches(folderPath);

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
      type: MediaType.COMICS,
      // Boost comics if naming patterns (Vol/Ch/#) match — distinguishes from generic ebooks
      score: comicCount + comicPatternCount * 2,
      reason: `${comicCount} comic/manga file(s)${comicPatternCount > 0 ? `, ${comicPatternCount} with vol/chapter markers` : ""}`
    },
    {
      type: MediaType.GENERIC_DOCS,
      score: docCount,
      reason: `${docCount} document file(s)`
    },
    {
      type: MediaType.EMULATION_ROMS,
      score: romCount,
      reason: `${romCount} ROM file(s)`
    },
    {
      type: MediaType.PODCAST_ARCHIVE,
      // Podcast detection: audio files with date patterns in names
      score: podcastPatternCount * 3,
      reason: `${podcastPatternCount} audio file(s) with date-based podcast naming`
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
    // If multiple resolution-tagged videos exist, suggest multi-version pattern
    if (resTaggedCount >= 2) {
      finalType = MediaType.JELLYFIN_MOVIE_VERSION;
    } else {
      finalType = MediaType.JELLYFIN_MOVIE;
    }
  }

  // If anime patterns are dominant, suggest anime pattern
  // Relaxed: either fansub tags OR absolute numbering is enough
  if (top.type === MediaType.JELLYFIN_TV && animePatternCount > tvPatternCount) {
    finalType = MediaType.ANIME;
  }
  // Even if TV patterns exist, strong anime signal overrides
  if (top.type === MediaType.JELLYFIN_TV && animePatternCount >= 2 && animePatternCount >= tvPatternCount) {
    finalType = MediaType.ANIME;
  }

  // If YouTube IDs found in video filenames, suggest YouTube archive
  // Relaxed: even a single file with a YouTube ID triggers detection
  if ((top.type === MediaType.JELLYFIN_TV || top.type === MediaType.JELLYFIN_MOVIE) && youtubeIdCount >= 1) {
    finalType = MediaType.YOUTUBE_ARCHIVE;
  }

  // If podcast patterns outscore plain music, override to podcast
  if (top.type === MediaType.MUSIC && podcastPatternCount >= 2) {
    finalType = MediaType.PODCAST_ARCHIVE;
  }

  const confidence = Math.min(top.score / totalFiles, 1);

  return {
    mediaType: finalType,
    confidence,
    reason: top.reason,
    extensionCounts: extCounts
  };
}
