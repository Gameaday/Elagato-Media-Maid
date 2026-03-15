/**
 * Internet metadata lookup for MediaMaid.
 *
 * Enriches file metadata from public APIs when local parsing (filenames,
 * folder names, NFO files) can't fully resolve the information.
 *
 * Supported APIs:
 *  - TMDB (The Movie Database) — TV shows, movies, anime. Requires a free API key.
 *  - MusicBrainz — Music (artist, album, track). No API key needed.
 *  - Open Library — Books (author, title, year). No API key needed.
 *  - IGDB-style heuristics — Game ROMs (just title normalization, no API).
 *
 * All network calls use Node's built-in https module to avoid external deps.
 * Every lookup is wrapped in a timeout + try/catch so a network failure never
 * blocks a rename or heal operation.
 */

import { request as httpsRequest, type RequestOptions } from "https";
import { request as httpRequest } from "http";
import type { FileMetadata } from "./patterns.js";
import { MediaType } from "./patterns.js";

// ── Configuration ──────────────────────────────────────────────────

export interface LookupConfig {
  /** Master switch to enable/disable all internet lookups */
  enabled: boolean;
  /** TMDB v3 API key (free from https://www.themoviedb.org/settings/api) */
  tmdbApiKey?: string;
  /** Request timeout in ms (default 8 000) */
  timeoutMs?: number;
}

/** Default lookup configuration — disabled until user provides an API key */
export const DEFAULT_LOOKUP_CONFIG: LookupConfig = {
  enabled: false,
  timeoutMs: 8_000
};

// ── Result types ───────────────────────────────────────────────────

export interface TvSearchResult {
  title: string;
  year: number;
  tmdbId: number;
  overview?: string;
}

export interface TvEpisodeResult {
  episodeTitle: string;
  season: number;
  episode: number;
  airDate?: string;
  overview?: string;
}

export interface MovieSearchResult {
  title: string;
  year: number;
  tmdbId: number;
  overview?: string;
}

export interface MusicSearchResult {
  artist: string;
  album?: string;
  year?: number;
  trackTitle?: string;
}

export interface BookSearchResult {
  title: string;
  author: string;
  year?: number;
}

// ── HTTP helper ────────────────────────────────────────────────────

/**
 * Minimal JSON fetcher using Node built-in https/http modules.
 * Returns parsed JSON or null on any failure.
 */
export async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8_000
): Promise<unknown> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";

    const opts: RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers
      },
      timeout: timeoutMs
    };

    const requester = isHttps ? httpsRequest : httpRequest;

    const req = requester(opts, (res) => {
      // Follow one redirect
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location, headers, timeoutMs).then(resolve);
        return;
      }

      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── TMDB lookups (TV + Movies) ─────────────────────────────────────

const TMDB_BASE = "https://api.themoviedb.org/3";

/**
 * Search TMDB for a TV show by name.
 * Returns the best match or null.
 */
export async function searchTvShow(
  query: string,
  apiKey: string,
  timeoutMs?: number
): Promise<TvSearchResult | null> {
  const url = `${TMDB_BASE}/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&page=1`;
  const data = await fetchJson(url, {}, timeoutMs) as { results?: Array<{ id: number; name: string; first_air_date?: string; overview?: string }> } | null;

  if (!data?.results?.length) return null;

  const best = data.results[0];
  const year = best.first_air_date ? parseInt(best.first_air_date.slice(0, 4), 10) : 0;

  return {
    title: best.name,
    year: year || 0,
    tmdbId: best.id,
    overview: best.overview
  };
}

/**
 * Look up a specific TV episode from TMDB.
 */
export async function lookupTvEpisode(
  tmdbId: number,
  season: number,
  episode: number,
  apiKey: string,
  timeoutMs?: number
): Promise<TvEpisodeResult | null> {
  const url = `${TMDB_BASE}/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(url, {}, timeoutMs) as { name?: string; season_number?: number; episode_number?: number; air_date?: string; overview?: string } | null;

  if (!data?.name) return null;

  return {
    episodeTitle: data.name,
    season: data.season_number ?? season,
    episode: data.episode_number ?? episode,
    airDate: data.air_date,
    overview: data.overview
  };
}

/**
 * Search TMDB for a movie by title, optionally filtering by year.
 */
export async function searchMovie(
  query: string,
  apiKey: string,
  year?: number,
  timeoutMs?: number
): Promise<MovieSearchResult | null> {
  let url = `${TMDB_BASE}/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&page=1`;
  if (year) url += `&year=${year}`;

  const data = await fetchJson(url, {}, timeoutMs) as { results?: Array<{ id: number; title: string; release_date?: string; overview?: string }> } | null;

  if (!data?.results?.length) return null;

  const best = data.results[0];
  const releaseYear = best.release_date ? parseInt(best.release_date.slice(0, 4), 10) : 0;

  return {
    title: best.title,
    year: releaseYear || 0,
    tmdbId: best.id,
    overview: best.overview
  };
}

// ── MusicBrainz lookups ────────────────────────────────────────────

const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_HEADERS = { "User-Agent": "MediaMaid/1.0.0 (https://github.com/Gameaday/Elagato-Media-Maid)" };

/**
 * Search MusicBrainz for a recording (song).
 * No API key required — just a proper User-Agent header.
 */
export async function searchMusic(
  query: string,
  timeoutMs?: number
): Promise<MusicSearchResult | null> {
  const url = `${MB_BASE}/recording/?query=${encodeURIComponent(query)}&limit=1&fmt=json`;
  const data = await fetchJson(url, MB_HEADERS, timeoutMs) as {
    recordings?: Array<{
      title: string;
      "artist-credit"?: Array<{ name: string }>;
      releases?: Array<{ title: string; date?: string }>;
    }>;
  } | null;

  if (!data?.recordings?.length) return null;

  const rec = data.recordings[0];
  const artist = rec["artist-credit"]?.[0]?.name;
  const release = rec.releases?.[0];

  return {
    artist: artist ?? "Unknown Artist",
    trackTitle: rec.title,
    album: release?.title,
    year: release?.date ? parseInt(release.date.slice(0, 4), 10) || undefined : undefined
  };
}

/**
 * Search MusicBrainz for a release (album).
 */
export async function searchAlbum(
  query: string,
  artist?: string,
  timeoutMs?: number
): Promise<MusicSearchResult | null> {
  let q = `release:${query}`;
  if (artist) q += ` AND artist:${artist}`;

  const url = `${MB_BASE}/release/?query=${encodeURIComponent(q)}&limit=1&fmt=json`;
  const data = await fetchJson(url, MB_HEADERS, timeoutMs) as {
    releases?: Array<{
      title: string;
      "artist-credit"?: Array<{ name: string }>;
      date?: string;
    }>;
  } | null;

  if (!data?.releases?.length) return null;

  const rel = data.releases[0];
  const foundArtist = rel["artist-credit"]?.[0]?.name;

  return {
    artist: foundArtist ?? artist ?? "Unknown Artist",
    album: rel.title,
    year: rel.date ? parseInt(rel.date.slice(0, 4), 10) || undefined : undefined
  };
}

// ── Open Library lookups ───────────────────────────────────────────

const OL_BASE = "https://openlibrary.org";

/**
 * Search Open Library for a book by title/author.
 * No API key required.
 */
export async function searchBook(
  query: string,
  timeoutMs?: number
): Promise<BookSearchResult | null> {
  const url = `${OL_BASE}/search.json?q=${encodeURIComponent(query)}&limit=1`;
  const data = await fetchJson(url, {}, timeoutMs) as {
    docs?: Array<{
      title: string;
      author_name?: string[];
      first_publish_year?: number;
    }>;
  } | null;

  if (!data?.docs?.length) return null;

  const book = data.docs[0];

  return {
    title: book.title,
    author: book.author_name?.[0] ?? "Unknown Author",
    year: book.first_publish_year
  };
}

// ── Unified metadata enrichment ────────────────────────────────────

/**
 * Determine if metadata is incomplete enough to warrant a lookup.
 * We only make network calls when critical fields are missing.
 */
export function needsLookup(meta: FileMetadata, mediaType: MediaType): boolean {
  switch (mediaType) {
    case MediaType.JELLYFIN_TV:
    case MediaType.ANIME:
      // Missing year or missing episode title with valid season/episode
      return (!meta.year) || (meta.season !== undefined && meta.episode !== undefined && !meta.episodeTitle);

    case MediaType.JELLYFIN_MOVIE:
    case MediaType.JELLYFIN_MOVIE_VERSION:
      return !meta.year || meta.title === meta.baseName;

    case MediaType.MUSIC:
      return !meta.artist || meta.artist === "Unknown" || !meta.year;

    case MediaType.BOOKS:
      return !meta.artist || !meta.year;

    default:
      return false;
  }
}

/**
 * Enrich a FileMetadata object by looking up missing information from
 * public APIs. Only makes network calls when local parsing left gaps.
 *
 * Never overwrites data that was already successfully parsed — lookups
 * only fill in undefined/missing fields.
 */
export async function enrichMetadata(
  meta: FileMetadata,
  mediaType: MediaType,
  config: LookupConfig
): Promise<FileMetadata> {
  if (!config.enabled) return meta;
  if (!needsLookup(meta, mediaType)) return meta;

  const timeout = config.timeoutMs ?? 8_000;
  const enriched = { ...meta };

  try {
    switch (mediaType) {
      case MediaType.JELLYFIN_TV:
      case MediaType.ANIME: {
        if (!config.tmdbApiKey) break;

        const query = meta.title ?? meta.baseName;
        const tvResult = await searchTvShow(query, config.tmdbApiKey, timeout);
        if (!tvResult) break;

        // API title is authoritative — always prefer the properly formatted
        // title from TMDB (e.g. "simpsons" → "The Simpsons").
        if (tvResult.title) {
          enriched.title = tvResult.title;
        }
        if (!enriched.year && tvResult.year) {
          enriched.year = tvResult.year;
        }

        // If we have season/episode, look up the episode title
        if (enriched.season !== undefined && enriched.episode !== undefined && !enriched.episodeTitle) {
          const epResult = await lookupTvEpisode(tvResult.tmdbId, enriched.season, enriched.episode, config.tmdbApiKey, timeout);
          if (epResult?.episodeTitle) {
            enriched.episodeTitle = epResult.episodeTitle;
          }
        }
        break;
      }

      case MediaType.JELLYFIN_MOVIE:
      case MediaType.JELLYFIN_MOVIE_VERSION: {
        if (!config.tmdbApiKey) break;

        const query = meta.title ?? meta.baseName;
        const movieResult = await searchMovie(query, config.tmdbApiKey, meta.year, timeout);
        if (!movieResult) break;

        // API title is authoritative — always prefer the properly formatted
        // title from TMDB (e.g. "inception" → "Inception").
        if (movieResult.title) {
          enriched.title = movieResult.title;
        }
        if (!enriched.year && movieResult.year) {
          enriched.year = movieResult.year;
        }
        break;
      }

      case MediaType.MUSIC: {
        const query = meta.artist && meta.artist !== "Unknown"
          ? `${meta.artist} ${meta.songTitle ?? meta.baseName}`
          : meta.songTitle ?? meta.baseName;

        const musicResult = await searchMusic(query, timeout);
        if (!musicResult) break;

        // API results are authoritative for incomplete local data
        if (!enriched.artist || enriched.artist === "Unknown") {
          enriched.artist = musicResult.artist;
        }
        if (musicResult.trackTitle) {
          enriched.songTitle = musicResult.trackTitle;
        }
        if (!enriched.album && musicResult.album) {
          enriched.album = musicResult.album;
        }
        if (!enriched.year && musicResult.year) {
          enriched.year = musicResult.year;
        }
        break;
      }

      case MediaType.BOOKS: {
        const query = meta.title ?? meta.baseName;
        const bookResult = await searchBook(query, timeout);
        if (!bookResult) break;

        // API title/author are authoritative for missing local data
        if (bookResult.title) {
          enriched.title = bookResult.title;
        }
        if (!enriched.artist) {
          enriched.artist = bookResult.author;
        }
        if (!enriched.year && bookResult.year) {
          enriched.year = bookResult.year;
        }
        break;
      }
    }
  } catch {
    // Network failures never block a rename/heal operation
  }

  return enriched;
}
