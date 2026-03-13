/**
 * NFO Writer/Editor for MediaMaid (Premium Feature).
 *
 * Creates, updates, and edits NFO metadata files for Jellyfin/Kodi
 * media libraries. Supports TV show, movie, and music NFO formats.
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, basename, extname } from "path";
import type { FileMetadata } from "./patterns.js";
import { parseNfoFile } from "./nfo-parser.js";
import { logOperation } from "./logger.js";
import { createSnapshot, pushUndoSnapshot } from "./undo-manager.js";

export type NfoType = "tvshow" | "episode" | "movie" | "artist" | "album";

export interface NfoField {
  /** XML tag name */
  tag: string;
  /** Human-readable label */
  label: string;
  /** Current value */
  value: string;
  /** Whether this field is editable */
  editable: boolean;
}

/** Template fields for each NFO type */
const NFO_TEMPLATES: Record<NfoType, NfoField[]> = {
  tvshow: [
    { tag: "title", label: "Show Title", value: "", editable: true },
    { tag: "showtitle", label: "Show Title (alt)", value: "", editable: true },
    { tag: "year", label: "Year", value: "", editable: true },
    { tag: "plot", label: "Plot", value: "", editable: true },
    { tag: "genre", label: "Genre", value: "", editable: true },
    { tag: "studio", label: "Studio", value: "", editable: true },
    { tag: "mpaa", label: "Rating", value: "", editable: true }
  ],
  episode: [
    { tag: "title", label: "Episode Title", value: "", editable: true },
    { tag: "showtitle", label: "Show Title", value: "", editable: true },
    { tag: "season", label: "Season", value: "", editable: true },
    { tag: "episode", label: "Episode", value: "", editable: true },
    { tag: "plot", label: "Plot", value: "", editable: true },
    { tag: "aired", label: "Air Date", value: "", editable: true },
    { tag: "director", label: "Director", value: "", editable: true }
  ],
  movie: [
    { tag: "title", label: "Movie Title", value: "", editable: true },
    { tag: "originaltitle", label: "Original Title", value: "", editable: true },
    { tag: "year", label: "Year", value: "", editable: true },
    { tag: "plot", label: "Plot", value: "", editable: true },
    { tag: "genre", label: "Genre", value: "", editable: true },
    { tag: "director", label: "Director", value: "", editable: true },
    { tag: "studio", label: "Studio", value: "", editable: true },
    { tag: "mpaa", label: "Rating", value: "", editable: true }
  ],
  artist: [
    { tag: "name", label: "Artist Name", value: "", editable: true },
    { tag: "genre", label: "Genre", value: "", editable: true },
    { tag: "biography", label: "Biography", value: "", editable: true }
  ],
  album: [
    { tag: "title", label: "Album Title", value: "", editable: true },
    { tag: "artist", label: "Artist", value: "", editable: true },
    { tag: "year", label: "Year", value: "", editable: true },
    { tag: "genre", label: "Genre", value: "", editable: true }
  ]
};

/**
 * Get the template fields for a given NFO type.
 */
export function getNfoTemplate(type: NfoType): NfoField[] {
  return NFO_TEMPLATES[type].map(f => ({ ...f }));
}

/**
 * Get all available NFO types.
 */
export function getNfoTypes(): NfoType[] {
  return Object.keys(NFO_TEMPLATES) as NfoType[];
}

/**
 * Read an existing NFO file and populate template fields.
 */
export async function readNfoFields(nfoPath: string): Promise<{ type: NfoType; fields: NfoField[] }> {
  const content = await readFile(nfoPath, "utf-8");
  const rootTagMatch = /<(\w+)[\s>]/.exec(content);
  const rootTag = rootTagMatch?.[1]?.toLowerCase() ?? "movie";

  let nfoType: NfoType = "movie";
  if (rootTag === "tvshow") nfoType = "tvshow";
  else if (rootTag === "episodedetails") nfoType = "episode";
  else if (rootTag === "artist") nfoType = "artist";
  else if (rootTag === "album") nfoType = "album";
  else if (rootTag === "movie") nfoType = "movie";

  const fields = getNfoTemplate(nfoType);

  // Parse values from existing content
  for (const field of fields) {
    const re = new RegExp(`<${field.tag}[^>]*>([^<]*)</${field.tag}>`, "i");
    const m = re.exec(content);
    if (m) {
      field.value = m[1].trim();
    }
  }

  return { type: nfoType, fields };
}

/**
 * Generate NFO XML content from fields.
 */
function generateNfoXml(type: NfoType, fields: NfoField[]): string {
  const rootTags: Record<NfoType, string> = {
    tvshow: "tvshow",
    episode: "episodedetails",
    movie: "movie",
    artist: "artist",
    album: "album"
  };

  const rootTag = rootTags[type];
  const lines = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`, `<${rootTag}>`];

  for (const field of fields) {
    if (field.value) {
      lines.push(`  <${field.tag}>${escapeXml(field.value)}</${field.tag}>`);
    }
  }

  lines.push(`</${rootTag}>`);
  return lines.join("\n") + "\n";
}

/**
 * Escape special characters for XML content.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Write or update an NFO file.
 */
export async function writeNfoFile(
  nfoPath: string,
  type: NfoType,
  fields: NfoField[],
  dryRun = false
): Promise<{ success: boolean; message: string }> {
  const content = generateNfoXml(type, fields);

  if (dryRun) {
    logOperation({
      operation: "dryrun",
      to: nfoPath,
      message: `DRY RUN – would write NFO: ${basename(nfoPath)}`
    });
    return { success: true, message: `Would write ${basename(nfoPath)}` };
  }

  try {
    const existed = existsSync(nfoPath);
    let originalContent: string | undefined;

    if (existed) {
      originalContent = await readFile(nfoPath, "utf-8");
    }

    await writeFile(nfoPath, content, "utf-8");

    logOperation({
      operation: existed ? "rename" : "mkdir",
      to: nfoPath,
      message: `${existed ? "Updated" : "Created"} NFO: ${basename(nfoPath)}`
    });

    // Create undo snapshot for NFO changes
    if (existed && originalContent !== undefined) {
      pushUndoSnapshot(createSnapshot(
        `NFO Edit – ${basename(nfoPath)}`,
        [{ type: "rename", from: nfoPath, to: nfoPath }]
      ));
    }

    return { success: true, message: `${existed ? "Updated" : "Created"} ${basename(nfoPath)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logOperation({ operation: "error", to: nfoPath, message: msg });
    return { success: false, message: msg };
  }
}

/**
 * Detect the appropriate NFO type for a media file.
 */
export function detectNfoType(mediaFilePath: string): NfoType {
  const ext = extname(mediaFilePath).toLowerCase();
  const dir = dirname(mediaFilePath);
  const name = basename(mediaFilePath);

  // Check for existing NFO that reveals the type
  if (existsSync(join(dir, "tvshow.nfo"))) return "tvshow";
  if (existsSync(join(dir, "episode.nfo"))) return "episode";
  if (existsSync(join(dir, "movie.nfo"))) return "movie";
  if (existsSync(join(dir, "artist.nfo"))) return "artist";
  if (existsSync(join(dir, "album.nfo"))) return "album";

  // Check filename patterns
  if (/[Ss]\d{1,2}[Ee]\d{1,2}/.test(name)) return "episode";
  if (/\b(19|20)\d{2}\b/.test(name) && [".mkv", ".mp4", ".avi"].includes(ext)) return "movie";
  if ([".flac", ".mp3", ".aac", ".ogg", ".m4a"].includes(ext)) return "album";

  return "movie"; // default
}

/**
 * Auto-create an NFO file for a media file based on parsed metadata.
 */
export async function autoCreateNfo(
  mediaFilePath: string,
  overrides?: Partial<Record<string, string>>,
  dryRun = false
): Promise<{ nfoPath: string; success: boolean; message: string }> {
  const type = detectNfoType(mediaFilePath);
  const dir = dirname(mediaFilePath);
  const base = basename(mediaFilePath, extname(mediaFilePath));

  let nfoPath: string;
  if (type === "tvshow") {
    nfoPath = join(dir, "tvshow.nfo");
  } else if (type === "episode") {
    nfoPath = join(dir, `${base}.nfo`);
  } else if (type === "artist") {
    nfoPath = join(dir, "artist.nfo");
  } else if (type === "album") {
    nfoPath = join(dir, "album.nfo");
  } else {
    nfoPath = join(dir, `${base}.nfo`);
  }

  // Try to parse existing metadata
  let existingMeta: Partial<FileMetadata> = {};
  if (existsSync(nfoPath)) {
    try {
      existingMeta = await parseNfoFile(nfoPath);
    } catch {
      // ignore
    }
  }

  const fields = getNfoTemplate(type);

  // Auto-populate from filename and existing metadata
  for (const field of fields) {
    if (overrides?.[field.tag]) {
      field.value = overrides[field.tag]!;
    } else if (field.tag === "title" && existingMeta.title) {
      field.value = existingMeta.title;
    } else if (field.tag === "showtitle" && existingMeta.title) {
      field.value = existingMeta.title;
    } else if (field.tag === "year" && existingMeta.year) {
      field.value = String(existingMeta.year);
    } else if (field.tag === "season" && existingMeta.season) {
      field.value = String(existingMeta.season);
    } else if (field.tag === "episode" && existingMeta.episode) {
      field.value = String(existingMeta.episode);
    } else if (field.tag === "artist" && existingMeta.artist) {
      field.value = existingMeta.artist;
    } else if (field.tag === "album" && existingMeta.album) {
      field.value = existingMeta.album;
    } else if (field.tag === "title") {
      // Fallback: use the base filename cleaned up
      field.value = base.replace(/[._-]/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  const writeResult = await writeNfoFile(nfoPath, type, fields, dryRun);
  return { nfoPath, ...writeResult };
}
