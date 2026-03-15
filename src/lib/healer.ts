/**
 * Collection Healer for MediaMaid.
 *
 * Identifies files with missing, incomplete, or inconsistent naming metadata
 * and attempts to "heal" them by inferring information from folder context,
 * sibling files, and NFO companions.
 *
 * Designed for large, long-lived collections accumulated over years from
 * various sources with inconsistent naming conventions.
 */

import { readdir, stat, rename, mkdir } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { detectMediaType } from "./detector.js";
import { getPattern } from "./patterns.js";
import type { NamingPattern, FileMetadata } from "./patterns.js";
import { MediaType } from "./patterns.js";
import {
  parseTvPattern,
  parseYearFromFilename,
  parseResolutionFromFilename,
  parseSourceFromFilename,
  parseHdrFromFilename,
  buildVersionTag,
  parseMovieTitle,
  parseMusicPattern,
  parseRomPattern,
  parseAnimePattern,
  parseYoutubePattern,
  parsePodcastPattern,
  parseComicPattern
} from "./renamer.js";
import { findAndParseNfo } from "./nfo-parser.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot, type FileOperation } from "./undo-manager.js";
import {
  VIDEO_EXTS,
  PHOTO_EXTS,
  AUDIO_EXTS,
  EBOOK_EXTS,
  DOCUMENT_EXTS,
  ROM_EXTS,
  COMIC_EXTS,
  SUBTITLE_EXTS,
  TV_EPISODE_RE,
  RESOLUTION_RE,
  DEFAULT_MAX_DEPTH,
  validateFolderPath,
  PLATFORM_MAP
} from "./config.js";

// ── Diagnostic types ───────────────────────────────────────────────

export type IssueSeverity = "error" | "warning" | "info";

export type IssueKind =
  | "missing_year"
  | "missing_episode_info"
  | "missing_season"
  | "generic_name"
  | "inconsistent_naming"
  | "missing_title"
  | "junk_tokens"
  | "wrong_extension_case"
  | "orphan_subtitle"
  | "orphan_nfo"
  | "missing_resolution_tag";

export interface FileIssue {
  /** Full path to the file */
  filePath: string;
  /** Current filename */
  currentName: string;
  /** Type of issue detected */
  kind: IssueKind;
  /** Severity level */
  severity: IssueSeverity;
  /** Human-readable description */
  description: string;
  /** Suggested fix (filename), if one can be computed */
  suggestedName?: string;
}

export interface DiagnoseResult {
  /** Total files examined */
  filesExamined: number;
  /** All issues found */
  issues: FileIssue[];
  /** Issues grouped by kind */
  issuesByKind: Record<string, number>;
  /** Issues grouped by severity */
  issuesBySeverity: Record<IssueSeverity, number>;
  /** Detected media type for the collection */
  detectedType: MediaType;
  /** Overall health score 0–100 */
  healthScore: number;
}

export interface HealResult {
  /** Total files examined */
  filesExamined: number;
  /** Issues found before healing */
  issuesFound: number;
  /** Files actually renamed/healed */
  healed: number;
  /** Files that would be healed (dry-run) */
  wouldHeal: number;
  /** Files skipped (already correct or unfixable) */
  skipped: number;
  /** Errors during healing */
  errors: Record<string, string>;
  /** Health score after healing */
  healthScoreAfter: number;
}

// ── All media extensions combined ──────────────────────────────────

const ALL_MEDIA_EXTS = new Set([
  ...VIDEO_EXTS, ...PHOTO_EXTS, ...AUDIO_EXTS, ...EBOOK_EXTS,
  ...DOCUMENT_EXTS, ...ROM_EXTS, ...COMIC_EXTS, ...SUBTITLE_EXTS
]);

// ── Constants ──────────────────────────────────────────────────────

/** Patterns that indicate a generic/meaningless filename */
const GENERIC_NAME_RE = /^(new\s*file|untitled|track\s*\d+|file|video|audio|img_?\d+|dsc_?\d+|mov_?\d+|vid_?\d+|rec_?\d+|capture|screenshot|screen\s*shot|clipboard|download|document)$/i;

/** Scene junk tokens often left in filenames from various sources */
const JUNK_TOKEN_RE = /\b(YIFY|YTS|RARBG|EVO|FGT|SPARKS|ETRG|STUTTERSHIT|AMZN|NTb|NTG|CM|EDITH|PSA|GECKOS|BONE|JYK|RMTeam|DIMENSION)\b/i;

/** Year regex for extraction */
const YEAR_RE = /\b((?:19|20)\d{2})\b/;

// ── Folder context inference ───────────────────────────────────────

export interface FolderContext {
  /** Show/movie title inferred from parent folder name */
  title?: string;
  /** Year inferred from parent folder name */
  year?: number;
  /** Season inferred from parent folder name (e.g. "Season 01") */
  season?: number;
  /** The dominant media type of sibling files */
  dominantType?: MediaType;
  /** Common title prefix among sibling files */
  commonPrefix?: string;
}

/**
 * Extract contextual metadata from the parent folder name.
 * Handles common patterns like:
 *   "Breaking Bad (2008)"
 *   "Season 01"
 *   "Inception (2010)"
 *   "Artist Name - Album Name (2020)"
 */
export function inferFromFolderName(folderName: string): Partial<FolderContext> {
  const ctx: Partial<FolderContext> = {};

  // Extract year from folder name
  const yearMatch = YEAR_RE.exec(folderName);
  if (yearMatch) {
    ctx.year = parseInt(yearMatch[1], 10);
  }

  // Check for "Season NN" pattern
  const seasonMatch = /[Ss]eason\s*(\d{1,2})/i.exec(folderName);
  if (seasonMatch) {
    ctx.season = parseInt(seasonMatch[1], 10);
    return ctx; // Season folders typically don't carry a show title
  }

  // Extract title: everything before the year (or the whole name if no year)
  let title = folderName;
  if (yearMatch) {
    title = folderName.slice(0, yearMatch.index).trim();
    // Remove trailing parenthesis, dash, or bracket
    title = title.replace(/[\s\-_([\]]+$/, "").trim();
  }
  // Remove common suffixes
  title = title.replace(/\s*-\s*$/, "").trim();

  if (title) {
    ctx.title = title;
  }

  return ctx;
}

/**
 * Find the longest common prefix among an array of strings.
 * Useful for detecting a common show/series name from sibling filenames.
 */
export function findCommonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];

  let prefix = names[0];
  for (let i = 1; i < names.length; i++) {
    while (!names[i].startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) return "";
  }

  // Trim trailing whitespace, dots, dashes, underscores
  prefix = prefix.replace(/[\s._\-]+$/, "");

  // Only return if it's meaningful (at least 3 chars)
  return prefix.length >= 3 ? prefix : "";
}

/**
 * Build folder context by examining the parent directory and sibling files.
 */
export async function buildFolderContext(filePath: string): Promise<FolderContext> {
  const dir = dirname(filePath);
  const folderName = basename(dir);
  const parentDir = dirname(dir);
  const parentFolderName = basename(parentDir);

  const ctx: FolderContext = {};

  // Infer from immediate folder
  const fromFolder = inferFromFolderName(folderName);
  if (fromFolder.title) ctx.title = fromFolder.title;
  if (fromFolder.year) ctx.year = fromFolder.year;
  if (fromFolder.season) ctx.season = fromFolder.season;

  // If immediate folder is "Season NN", look at grandparent for title
  if (fromFolder.season && !fromFolder.title) {
    const fromParent = inferFromFolderName(parentFolderName);
    if (fromParent.title) ctx.title = fromParent.title;
    if (fromParent.year) ctx.year = fromParent.year;
  }

  // Collect sibling filenames for common prefix detection
  try {
    const entries = await readdir(dir);
    const siblings = entries
      .filter(n => {
        const ext = extname(n).toLowerCase();
        return ALL_MEDIA_EXTS.has(ext);
      })
      .map(n => basename(n, extname(n)));

    if (siblings.length >= 2) {
      ctx.commonPrefix = findCommonPrefix(siblings);
    }
  } catch {
    // ignore errors
  }

  return ctx;
}

// ── File diagnosis ─────────────────────────────────────────────────

/**
 * Diagnose issues with a single file's naming.
 * Returns an array of issues (a file can have multiple problems).
 */
export function diagnoseFile(
  filePath: string,
  mediaType: MediaType,
  context?: FolderContext
): FileIssue[] {
  const issues: FileIssue[] = [];
  const fileName = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const baseName = basename(filePath, ext);

  // 1. Check for wrong extension case (e.g. ".MKV" instead of ".mkv")
  const actualExt = extname(filePath);
  if (actualExt !== actualExt.toLowerCase() && ALL_MEDIA_EXTS.has(ext)) {
    // Strip the actual (case-preserving) extension to get the true base name
    const trueBase = basename(filePath, actualExt);
    issues.push({
      filePath,
      currentName: fileName,
      kind: "wrong_extension_case",
      severity: "warning",
      description: `Extension "${actualExt}" should be lowercase "${ext}"`,
      suggestedName: trueBase + ext
    });
  }

  // 2. Check for generic/meaningless filenames
  if (GENERIC_NAME_RE.test(baseName)) {
    issues.push({
      filePath,
      currentName: fileName,
      kind: "generic_name",
      severity: "error",
      description: `Filename "${baseName}" is generic and provides no useful metadata`
    });
  }

  // 3. Check for scene junk tokens
  if (JUNK_TOKEN_RE.test(baseName)) {
    const match = JUNK_TOKEN_RE.exec(baseName);
    issues.push({
      filePath,
      currentName: fileName,
      kind: "junk_tokens",
      severity: "warning",
      description: `Filename contains scene/release group junk token "${match?.[1]}"`
    });
  }

  // 4. Media-type-specific checks
  if (mediaType === MediaType.JELLYFIN_TV || mediaType === MediaType.ANIME) {
    // TV: should have season and episode info
    const tvMeta = parseTvPattern(baseName);
    if (!tvMeta.season && !tvMeta.episode) {
      // Check for anime absolute numbering
      const animeMeta = parseAnimePattern(baseName);
      if (!animeMeta.absoluteEpisode && !animeMeta.episode) {
        issues.push({
          filePath,
          currentName: fileName,
          kind: "missing_episode_info",
          severity: "error",
          description: "Video file in TV/anime collection has no episode numbering (SxxExx or absolute)"
        });
      }
    }
    if (tvMeta.season === undefined && context?.season === undefined) {
      issues.push({
        filePath,
        currentName: fileName,
        kind: "missing_season",
        severity: "warning",
        description: "No season number detected in filename or folder context"
      });
    }
  }

  if (mediaType === MediaType.JELLYFIN_MOVIE || mediaType === MediaType.JELLYFIN_MOVIE_VERSION) {
    // Movies: should have a year
    const year = parseYearFromFilename(baseName);
    if (!year && !context?.year) {
      issues.push({
        filePath,
        currentName: fileName,
        kind: "missing_year",
        severity: "warning",
        description: "Movie file has no release year in filename or folder"
      });
    }

    // Multi-version: should have resolution tag
    if (mediaType === MediaType.JELLYFIN_MOVIE_VERSION) {
      const res = parseResolutionFromFilename(baseName);
      if (!res) {
        issues.push({
          filePath,
          currentName: fileName,
          kind: "missing_resolution_tag",
          severity: "warning",
          description: "Multi-version movie file has no resolution tag (720p, 1080p, 4K)"
        });
      }
    }
  }

  if (mediaType === MediaType.MUSIC) {
    const musicMeta = parseMusicPattern(baseName);
    if (!musicMeta.artist && !context?.title) {
      issues.push({
        filePath,
        currentName: fileName,
        kind: "missing_title",
        severity: "warning",
        description: "Music file has no identifiable artist name"
      });
    }
  }

  return issues;
}

// ── Collection diagnosis ───────────────────────────────────────────

/**
 * Recursively collect all files from a directory tree.
 */
async function collectFiles(dir: string, maxDepth = DEFAULT_MAX_DEPTH, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];

  const results: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
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
      results.push(...await collectFiles(fullPath, maxDepth, depth + 1));
    } else if (fileStat.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Diagnose an entire collection directory for naming issues.
 * Scans recursively and reports all files with problems.
 */
export async function diagnoseCollection(collectionPath: string): Promise<DiagnoseResult> {
  const result: DiagnoseResult = {
    filesExamined: 0,
    issues: [],
    issuesByKind: {},
    issuesBySeverity: { error: 0, warning: 0, info: 0 },
    detectedType: MediaType.UNKNOWN,
    healthScore: 100
  };

  const pathCheck = validateFolderPath(collectionPath);
  if (!pathCheck.valid) {
    return result;
  }

  // Detect media type
  const detection = await detectMediaType(collectionPath);
  result.detectedType = detection.mediaType;

  // Collect all files
  const allFiles = await collectFiles(collectionPath);
  result.filesExamined = allFiles.length;

  if (allFiles.length === 0) return result;

  // Diagnose each file
  const contextCache = new Map<string, FolderContext>();

  for (const filePath of allFiles) {
    const ext = extname(filePath).toLowerCase();
    if (!ALL_MEDIA_EXTS.has(ext)) continue;

    // Get or build folder context (cached per directory)
    const dir = dirname(filePath);
    let context = contextCache.get(dir);
    if (!context) {
      context = await buildFolderContext(filePath);
      contextCache.set(dir, context);
    }

    const fileIssues = diagnoseFile(filePath, detection.mediaType, context);
    for (const issue of fileIssues) {
      result.issues.push(issue);
      result.issuesByKind[issue.kind] = (result.issuesByKind[issue.kind] ?? 0) + 1;
      result.issuesBySeverity[issue.severity]++;
    }
  }

  // Calculate health score: percentage of media files with no issues
  const mediaFiles = allFiles.filter(f => ALL_MEDIA_EXTS.has(extname(f).toLowerCase()));
  const filesWithIssues = new Set(result.issues.map(i => i.filePath));
  const cleanFiles = mediaFiles.filter(f => !filesWithIssues.has(f)).length;
  result.healthScore = mediaFiles.length > 0
    ? Math.round((cleanFiles / mediaFiles.length) * 100)
    : 100;

  return result;
}

// ── Collection healing ─────────────────────────────────────────────

/**
 * Build a healed filename for a file using folder context and pattern inference.
 * Returns the suggested new filename (just the basename, not the full path),
 * or null if no healing is possible.
 */
export function buildHealedName(
  filePath: string,
  mediaType: MediaType,
  context: FolderContext
): string | null {
  const ext = extname(filePath).toLowerCase();
  const baseName = basename(filePath, ext);
  const pattern = getPattern(mediaType);
  if (!pattern) return null;

  // Don't try to heal non-media files
  if (!pattern.extensions.includes(ext)) return null;

  // Build metadata from the filename, then enrich from context
  const meta: FileMetadata = {
    baseName,
    ext,
    originalPath: filePath
  };

  // Apply media-type-specific parsing
  switch (mediaType) {
    case MediaType.JELLYFIN_TV: {
      const parsed = parseTvPattern(baseName);
      Object.assign(meta, parsed);
      // Context title takes precedence — the folder name is a more reliable
      // source of truth than a partial title parsed from a mangled filename.
      if (context.title) meta.title = context.title;
      if (context.season !== undefined) meta.season = context.season;
      if (!meta.year && context.year) meta.year = context.year;
      break;
    }
    case MediaType.JELLYFIN_MOVIE:
    case MediaType.JELLYFIN_MOVIE_VERSION: {
      const title = parseMovieTitle(baseName);
      // Context title takes precedence over filename-parsed title
      meta.title = context.title ?? title;
      meta.year = parseYearFromFilename(baseName) ?? context.year;
      meta.resolution = parseResolutionFromFilename(baseName);
      meta.source = parseSourceFromFilename(baseName);
      meta.hdr = parseHdrFromFilename(baseName);
      meta.versionTag = buildVersionTag(baseName);
      break;
    }
    case MediaType.MUSIC: {
      const parsed = parseMusicPattern(baseName);
      Object.assign(meta, parsed);
      // Context title (from folder) is a more reliable artist source
      if (context.title) meta.artist = context.title;
      if (!meta.year && context.year) meta.year = context.year;
      break;
    }
    case MediaType.ANIME: {
      const parsed = parseAnimePattern(baseName);
      Object.assign(meta, parsed);
      // Context title takes precedence
      if (context.title) meta.title = context.title;
      if (context.season !== undefined) meta.season = context.season;
      break;
    }
    case MediaType.EMULATION_ROMS: {
      const parsed = parseRomPattern(baseName, ext);
      Object.assign(meta, parsed);
      break;
    }
    case MediaType.YOUTUBE_ARCHIVE: {
      const parsed = parseYoutubePattern(baseName);
      Object.assign(meta, parsed);
      break;
    }
    case MediaType.PODCAST_ARCHIVE: {
      const parsed = parsePodcastPattern(baseName);
      Object.assign(meta, parsed);
      break;
    }
    case MediaType.COMICS: {
      const parsed = parseComicPattern(baseName);
      Object.assign(meta, parsed);
      break;
    }
    default: {
      meta.title = meta.title ?? baseName;
      meta.year = parseYearFromFilename(baseName) ?? context.year;
      break;
    }
  }

  // Ensure we have a title
  if (!meta.title) meta.title = baseName;

  // Generate the expected filename
  const expectedName = pattern.format(meta);
  const currentName = basename(filePath);

  // Only suggest a change if the name would actually differ
  if (currentName === expectedName) return null;

  return expectedName;
}

/**
 * Heal an entire collection by applying inferred metadata and consistent
 * naming patterns across all files.
 *
 * @param collectionPath - Root directory of the collection.
 * @param dryRun         - If true, no files are actually renamed.
 * @param targetType     - Override the auto-detected media type.
 * @returns              - Summary of healing operations performed.
 */
export async function healCollection(
  collectionPath: string,
  dryRun = false,
  targetType?: MediaType
): Promise<HealResult> {
  const result: HealResult = {
    filesExamined: 0,
    issuesFound: 0,
    healed: 0,
    wouldHeal: 0,
    skipped: 0,
    errors: {},
    healthScoreAfter: 100
  };

  const pathCheck = validateFolderPath(collectionPath);
  if (!pathCheck.valid) {
    result.errors["[path]"] = pathCheck.reason ?? "Invalid path.";
    return result;
  }

  // Detect or use specified media type
  const mediaType = targetType ?? (await detectMediaType(collectionPath)).mediaType;
  const pattern = getPattern(mediaType);

  if (!pattern) {
    result.errors["[detection]"] = `Could not determine pattern for type: ${mediaType}`;
    return result;
  }

  // Collect all files
  const allFiles = await collectFiles(collectionPath);
  result.filesExamined = allFiles.length;

  if (allFiles.length === 0) return result;

  // First pass: diagnose to count issues
  const diagnosis = await diagnoseCollection(collectionPath);
  result.issuesFound = diagnosis.issues.length;

  // Second pass: heal each file
  const undoOps: FileOperation[] = [];
  const contextCache = new Map<string, FolderContext>();
  const existingPaths = new Set(allFiles);

  for (const filePath of allFiles) {
    const ext = extname(filePath).toLowerCase();
    if (!pattern.extensions.includes(ext)) {
      result.skipped++;
      continue;
    }

    // Get folder context
    const dir = dirname(filePath);
    let context = contextCache.get(dir);
    if (!context) {
      context = await buildFolderContext(filePath);
      contextCache.set(dir, context);
    }

    // Also enrich context from NFO data if available
    try {
      const nfoMeta = await findAndParseNfo(filePath);
      if (nfoMeta.title && !context.title) context.title = nfoMeta.title;
      if (nfoMeta.year && !context.year) context.year = nfoMeta.year;
    } catch {
      // ignore NFO errors
    }

    const healedName = buildHealedName(filePath, mediaType, context);
    if (!healedName) {
      result.skipped++;
      continue;
    }

    const newPath = join(dir, healedName);

    if (dryRun) {
      logOperation({
        operation: "dryrun",
        from: filePath,
        to: newPath,
        message: `DRY RUN – would heal: "${basename(filePath)}" → "${healedName}"`
      });
      result.wouldHeal++;
    } else {
      try {
        // Deconflict if target already exists
        let finalPath = newPath;
        if (existingPaths.has(finalPath) && finalPath !== filePath) {
          const base = finalPath.slice(0, -ext.length);
          let counter = 2;
          while (existingPaths.has(`${base} (${counter})${ext}`)) {
            counter++;
          }
          finalPath = `${base} (${counter})${ext}`;
        }

        await rename(filePath, finalPath);
        existingPaths.delete(filePath);
        existingPaths.add(finalPath);
        undoOps.push({ type: "rename", from: filePath, to: finalPath });
        result.healed++;
        logOperation({
          operation: "rename",
          from: filePath,
          to: finalPath,
          message: `Healed: "${basename(filePath)}" → "${basename(finalPath)}"`
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors[filePath] = msg;
      }
    }
  }

  if (!dryRun && undoOps.length > 0) {
    pushUndoSnapshot(createSnapshot(`Collection Heal – ${pattern.label}`, undoOps));
  }

  // Recalculate health score after healing
  if (!dryRun && result.healed > 0) {
    const afterDiagnosis = await diagnoseCollection(collectionPath);
    result.healthScoreAfter = afterDiagnosis.healthScore;
  } else {
    result.healthScoreAfter = diagnosis.healthScore;
  }

  return result;
}
