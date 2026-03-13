/**
 * NFO file parser for extracting metadata from Jellyfin/Kodi-style XML metadata files.
 *
 * NFO files are XML files placed alongside media files with names like:
 *   tvshow.nfo, episode.nfo, movie.nfo, artist.nfo, album.nfo
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import type { FileMetadata } from "./patterns.js";

interface RawNfoData {
  title?: string;
  year?: string | number;
  season?: string | number;
  episode?: string | number;
  episodetitle?: string;
  showtitle?: string;
  artist?: string;
  album?: string;
  track?: string | number;
  originaltitle?: string;
}

/**
 * Minimal XML parser that extracts simple tag values.
 * Avoids a full XML parser dependency to keep the plugin lightweight.
 */
function parseSimpleXml(xml: string): RawNfoData {
  const get = (tag: string): string | undefined => {
    const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
    const m = re.exec(xml);
    return m ? m[1].trim() : undefined;
  };

  return {
    title: get("title"),
    year: get("year"),
    season: get("season"),
    episode: get("episode"),
    episodetitle: get("episodetitle"),
    showtitle: get("showtitle"),
    artist: get("artist"),
    album: get("album"),
    track: get("track"),
    originaltitle: get("originaltitle")
  };
}

/**
 * Read and parse an NFO file, returning a partial FileMetadata object.
 */
export async function parseNfoFile(nfoPath: string): Promise<Partial<FileMetadata>> {
  const xml = await readFile(nfoPath, "utf-8");
  const raw = parseSimpleXml(xml);

  const meta: Partial<FileMetadata> = {};

  if (raw.showtitle) meta.title = raw.showtitle;
  else if (raw.title) meta.title = raw.title;

  if (raw.year) meta.year = parseInt(String(raw.year), 10) || undefined;
  if (raw.season) meta.season = parseInt(String(raw.season), 10) || undefined;
  if (raw.episode) meta.episode = parseInt(String(raw.episode), 10) || undefined;
  if (raw.episodetitle) meta.episodeTitle = raw.episodetitle;
  if (raw.artist) meta.artist = raw.artist;
  if (raw.album) meta.album = raw.album;
  if (raw.track) meta.trackNumber = parseInt(String(raw.track), 10) || undefined;

  return meta;
}

/**
 * Attempt to find and parse an NFO file for the given media file.
 * Looks for: same-name .nfo, episode.nfo, tvshow.nfo, movie.nfo in the same directory.
 */
export async function findAndParseNfo(mediaFilePath: string): Promise<Partial<FileMetadata>> {
  const dir = dirname(mediaFilePath);
  const base = mediaFilePath.slice(0, mediaFilePath.lastIndexOf("."));

  const candidates = [
    `${base}.nfo`,
    join(dir, "episode.nfo"),
    join(dir, "movie.nfo"),
    join(dir, "tvshow.nfo")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return await parseNfoFile(candidate);
      } catch {
        // ignore parse errors and try next candidate
      }
    }
  }

  return {};
}
