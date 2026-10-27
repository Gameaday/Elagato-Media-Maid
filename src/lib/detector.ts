/**
 * Content-type detector for MediaMaid.
 *
 * Analyzes a folder's file extensions, counts, and naming patterns to guess
 * the dominant media type so the correct renaming pattern can be applied.
 *
 * The folder is walked exactly ONCE: the walk collects extension counts and
 * the names of all top-level entries, and every pattern counter (TV episode
 * patterns, NFO presence, resolution tags, YouTube IDs, anime patterns,
 * podcast patterns, comic patterns) is evaluated from that single
 * in-memory snapshot — previously the same directory was read once for
 * extension collection plus seven more times, one per pattern family.
 * A file cap keeps the walk bounded on very large libraries.
 */

import { readdir, stat } from "fs/promises";
import type { Dirent } from "fs";
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
  DETECTION_MAX_FILES,
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

/** Everything the single detection walk learns about a folder. */
interface FolderScan {
  /** Extension counts across all walked files (recursive, up to maxDepth). */
  extensionCounts: Record<string, number>;
  /** Total number of counted files (files with an extension only, like the old extension walk). */
  totalFiles: number;
  /** Names of every top-level entry (files AND folders), for pattern tests. */
  topLevelNames: string[];
}

/**
 * Walk a directory once, collecting extension counts (recursive, up to
 * maxDepth levels deep) and the names of all top-level entries. Symlinks
 * are resolved via stat() so linked files and folders are still counted,
 * exactly like the previous stat()-based walk did.
 *
 * The walk stops early once DETECTION_MAX_FILES files have been counted,
 * so very large libraries cannot make a scan run unbounded.
 */
async function scanFolder(
  dir: string,
  scan: FolderScan,
  depth = 0,
  maxDepth = DETECTION_MAX_DEPTH
): Promise<void> {
  if (scan.totalFiles >= DETECTION_MAX_FILES) return;

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // Top-level names feed the pattern counters below, exactly like the
    // old one-readdir-per-pattern passes (which saw files AND folders).
    if (depth === 0) {
      scan.topLevelNames.push(entry.name);
    }

    const fullPath = join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();

    if (!isDir && !isFile && entry.isSymbolicLink()) {
      // Resolve symlinks the way the previous stat() call did, so
      // symlinked files and directories are still counted.
      try {
        const resolved = await stat(fullPath);
        isDir = resolved.isDirectory();
        isFile = resolved.isFile();
      } catch {
        continue;
      }
    }

    if (isDir && depth < maxDepth) {
      await scanFolder(fullPath, scan, depth + 1, maxDepth);
    } else if (isFile) {
      if (scan.totalFiles >= DETECTION_MAX_FILES) return;
      const ext = extname(entry.name).toLowerCase();
      if (ext) {
        scan.extensionCounts[ext] = (scan.extensionCounts[ext] ?? 0) + 1;
        scan.totalFiles++;
      }
    }
  }
}

/**
 * Evaluate every naming-pattern counter from the single scan snapshot.
 * Mirrors the semantics of the previous per-pattern readdir passes:
 * name-only patterns (TV, YouTube, NFO) test every top-level entry,
 * extension-gated patterns test only entries with a matching extension.
 */
function evaluatePatterns(scan: FolderScan): {
  tvPatternCount: number;
  nfoPresent: boolean;
  resTaggedCount: number;
  youtubeIdCount: number;
  animePatternCount: number;
  podcastPatternCount: number;
  comicPatternCount: number;
} {
  let tvPatternCount = 0;
  let nfoPresent = false;
  let resTaggedCount = 0;
  let youtubeIdCount = 0;
  let animePatternCount = 0;
  let podcastPatternCount = 0;
  let comicPatternCount = 0;

  for (const name of scan.topLevelNames) {
    const ext = extname(name).toLowerCase();

    if (TV_EPISODE_RE.test(name)) tvPatternCount++;
    if (!nfoPresent && name.toLowerCase().endsWith(".nfo")) nfoPresent = true;
    if (VIDEO_EXTS.has(ext) && RESOLUTION_RE.test(name)) resTaggedCount++;
    if (YOUTUBE_ID_RE.test(name)) youtubeIdCount++;

    if (VIDEO_EXTS.has(ext)) {
      // Fansub group tags [SubGroup] at start, or absolute episode
      // numbering without SxxExx — common anime naming.
      const hasFansubTag = FANSUB_TAG_RE.test(name);
      const hasAbsoluteEp = ABSOLUTE_EPISODE_RE.test(name) && !TV_EPISODE_RE.test(name);
      if (hasFansubTag || hasAbsoluteEp) animePatternCount++;
    }

    // Audio-capable extension with a YYYY-MM-DD date in the name —
    // typical podcast archive naming.
    if (PODCAST_EXTS.has(ext) && DATE_FILENAME_RE.test(name)) podcastPatternCount++;

    // Comic/manga naming goes beyond extension matching: volume/chapter
    // or issue-number markers confirm the convention.
    if (COMIC_EXTS.has(ext) && (COMIC_VOLUME_RE.test(name) || COMIC_CHAPTER_RE.test(name) || /#\d+/.test(name))) {
      comicPatternCount++;
    }
  }

  return {
    tvPatternCount,
    nfoPresent,
    resTaggedCount,
    youtubeIdCount,
    animePatternCount,
    podcastPatternCount,
    comicPatternCount
  };
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

  // One walk collects everything; every counter below is evaluated from
  // this single snapshot instead of re-reading the folder per pattern.
  const scan: FolderScan = { extensionCounts: {}, totalFiles: 0, topLevelNames: [] };
  await scanFolder(folderPath, scan);
  const extCounts = scan.extensionCounts;
  const totalFiles = scan.totalFiles;

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

  const {
    tvPatternCount,
    nfoPresent,
    resTaggedCount,
    youtubeIdCount,
    animePatternCount,
    podcastPatternCount,
    comicPatternCount
  } = evaluatePatterns(scan);

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

  // Confidence must reflect the share of files that actually support the
  // detected type. The ranking scores above include pattern multipliers
  // (×2, ×3) and flat bonuses (+3) that are useful for choosing a winner
  // but inflate the raw score/totalFiles ratio — a folder with 3
  // date-named episodes and one plain track previously reported 100%
  // instead of 75%. Base confidence on the plain supporting-file count
  // for the type we ended up with.
  const supportingFiles = ((): number => {
    switch (finalType) {
      case MediaType.JELLYFIN_TV:
      case MediaType.JELLYFIN_MOVIE:
      case MediaType.JELLYFIN_MOVIE_VERSION:
      case MediaType.ANIME:
        return videoCount;
      case MediaType.PHOTOGRAPHY:
        return photoCount;
      case MediaType.MUSIC:
        return musicCount;
      case MediaType.BOOKS:
        return bookCount;
      case MediaType.COMICS:
        return comicCount;
      case MediaType.GENERIC_DOCS:
        return docCount;
      case MediaType.EMULATION_ROMS:
        return romCount;
      case MediaType.PODCAST_ARCHIVE:
        return podcastPatternCount;
      case MediaType.YOUTUBE_ARCHIVE:
        return youtubeIdCount;
      default:
        return top.score;
    }
  })();

  const confidence = Math.min(supportingFiles / totalFiles, 1);

  return {
    mediaType: finalType,
    confidence,
    reason: top.reason,
    extensionCounts: extCounts
  };
}
