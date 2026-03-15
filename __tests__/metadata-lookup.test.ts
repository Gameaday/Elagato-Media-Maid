/**
 * Tests for src/lib/metadata-lookup.ts
 * Internet-based metadata enrichment with mocked HTTP responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { MediaType } from "../src/lib/patterns";
import type { FileMetadata } from "../src/lib/patterns";
import type { LookupConfig } from "../src/lib/metadata-lookup";

// ── Mock the https/http modules before importing ───────────────────

const mockResponseData: { body: string; statusCode: number; headers: Record<string, string> } = {
  body: "{}",
  statusCode: 200,
  headers: {}
};

let lastRequestUrl = "";
let lastRequestHeaders: Record<string, string> = {};

function buildMockRes(): Record<string, unknown> {
  const self: Record<string, unknown> = {
    statusCode: mockResponseData.statusCode,
    headers: mockResponseData.headers,
    setEncoding: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "data") handler(mockResponseData.body);
      if (event === "end") handler();
      return self;
    })
  };
  return self;
}

jest.mock("https", () => ({
  request: jest.fn((opts: any, cb: any) => {
    lastRequestUrl = `https://${opts.hostname}${opts.path}`;
    lastRequestHeaders = opts.headers ?? {};
    cb(buildMockRes());
    return { on: jest.fn(() => ({})), end: jest.fn(), destroy: jest.fn() };
  })
}));

jest.mock("http", () => ({
  request: jest.fn((opts: any, cb: any) => {
    lastRequestUrl = `http://${opts.hostname}${opts.path}`;
    lastRequestHeaders = opts.headers ?? {};
    cb(buildMockRes());
    return { on: jest.fn(() => ({})), end: jest.fn(), destroy: jest.fn() };
  })
}));

// Now import the module under test
import {
  fetchJson,
  searchTvShow,
  lookupTvEpisode,
  searchMovie,
  searchMusic,
  searchAlbum,
  searchBook,
  needsLookup,
  enrichMetadata,
  DEFAULT_LOOKUP_CONFIG
} from "../src/lib/metadata-lookup";

function setMockResponse(body: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  mockResponseData.body = JSON.stringify(body);
  mockResponseData.statusCode = statusCode;
  mockResponseData.headers = headers;
}

function baseMeta(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    baseName: "test",
    ext: ".mkv",
    originalPath: "/test/test.mkv",
    ...overrides
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("DEFAULT_LOOKUP_CONFIG", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_LOOKUP_CONFIG.enabled).toBe(false);
    expect(DEFAULT_LOOKUP_CONFIG.timeoutMs).toBe(8_000);
  });
});

describe("fetchJson", () => {
  it("parses a JSON response", async () => {
    setMockResponse({ hello: "world" });
    const result = await fetchJson("https://example.com/api") as any;
    expect(result).toEqual({ hello: "world" });
  });

  it("returns null on invalid JSON", async () => {
    mockResponseData.body = "not json";
    mockResponseData.statusCode = 200;
    const result = await fetchJson("https://example.com/api");
    expect(result).toBeNull();
  });

  it("includes Accept: application/json header", async () => {
    setMockResponse({});
    await fetchJson("https://example.com/api");
    expect(lastRequestHeaders["Accept"]).toBe("application/json");
  });

  it("merges custom headers", async () => {
    setMockResponse({});
    await fetchJson("https://example.com/api", { "User-Agent": "TestBot/1.0" });
    expect(lastRequestHeaders["User-Agent"]).toBe("TestBot/1.0");
    expect(lastRequestHeaders["Accept"]).toBe("application/json");
  });
});

// ── TMDB TV Search ─────────────────────────────────────────────────

describe("searchTvShow", () => {
  it("returns the best match from TMDB search results", async () => {
    setMockResponse({
      results: [
        { id: 456, name: "The Simpsons", first_air_date: "1989-12-17", overview: "An animated sitcom." }
      ]
    });

    const result = await searchTvShow("simpsons", "test-api-key");
    expect(result).toEqual({
      title: "The Simpsons",
      year: 1989,
      tmdbId: 456,
      overview: "An animated sitcom."
    });
    expect(lastRequestUrl).toContain("api.themoviedb.org");
    expect(lastRequestUrl).toContain("query=simpsons");
    expect(lastRequestUrl).toContain("api_key=test-api-key");
  });

  it("returns null when no results", async () => {
    setMockResponse({ results: [] });
    const result = await searchTvShow("xyznonexistent", "key");
    expect(result).toBeNull();
  });

  it("returns null on network failure", async () => {
    setMockResponse(null);
    const result = await searchTvShow("simpsons", "key");
    expect(result).toBeNull();
  });

  it("handles missing first_air_date", async () => {
    setMockResponse({
      results: [{ id: 1, name: "Some Show" }]
    });
    const result = await searchTvShow("some show", "key");
    expect(result?.year).toBe(0);
    expect(result?.title).toBe("Some Show");
  });
});

// ── TMDB TV Episode ────────────────────────────────────────────────

describe("lookupTvEpisode", () => {
  it("returns episode details from TMDB", async () => {
    setMockResponse({
      name: "Simpsons Roasting on an Open Fire",
      season_number: 1,
      episode_number: 1,
      air_date: "1989-12-17",
      overview: "The first episode."
    });

    const result = await lookupTvEpisode(456, 1, 1, "test-key");
    expect(result).toEqual({
      episodeTitle: "Simpsons Roasting on an Open Fire",
      season: 1,
      episode: 1,
      airDate: "1989-12-17",
      overview: "The first episode."
    });
    expect(lastRequestUrl).toContain("/tv/456/season/1/episode/1");
  });

  it("returns null when episode not found", async () => {
    setMockResponse({});
    const result = await lookupTvEpisode(456, 99, 99, "key");
    expect(result).toBeNull();
  });

  it("uses fallback season/episode when TMDB omits them", async () => {
    setMockResponse({ name: "Test Episode" });
    const result = await lookupTvEpisode(1, 3, 7, "key");
    expect(result?.season).toBe(3);
    expect(result?.episode).toBe(7);
  });
});

// ── TMDB Movie Search ──────────────────────────────────────────────

describe("searchMovie", () => {
  it("returns movie details from TMDB", async () => {
    setMockResponse({
      results: [
        { id: 27205, title: "Inception", release_date: "2010-07-16", overview: "A thief who steals..." }
      ]
    });

    const result = await searchMovie("Inception", "key", 2010);
    expect(result).toEqual({
      title: "Inception",
      year: 2010,
      tmdbId: 27205,
      overview: "A thief who steals..."
    });
    expect(lastRequestUrl).toContain("year=2010");
  });

  it("searches without year when not provided", async () => {
    setMockResponse({
      results: [
        { id: 100, title: "Movie", release_date: "2024-01-01" }
      ]
    });

    const result = await searchMovie("Movie", "key");
    expect(result?.title).toBe("Movie");
    expect(lastRequestUrl).not.toContain("year=");
  });

  it("returns null when no results", async () => {
    setMockResponse({ results: [] });
    const result = await searchMovie("xyz", "key");
    expect(result).toBeNull();
  });
});

// ── MusicBrainz ────────────────────────────────────────────────────

describe("searchMusic", () => {
  it("returns recording details from MusicBrainz", async () => {
    setMockResponse({
      recordings: [{
        title: "Bohemian Rhapsody",
        "artist-credit": [{ name: "Queen" }],
        releases: [{ title: "A Night at the Opera", date: "1975-10-31" }]
      }]
    });

    const result = await searchMusic("bohemian rhapsody");
    expect(result).toEqual({
      artist: "Queen",
      trackTitle: "Bohemian Rhapsody",
      album: "A Night at the Opera",
      year: 1975
    });
    expect(lastRequestUrl).toContain("musicbrainz.org");
    expect(lastRequestHeaders["User-Agent"]).toContain("MediaMaid");
  });

  it("returns null when no recordings found", async () => {
    setMockResponse({ recordings: [] });
    const result = await searchMusic("xyznonexistent");
    expect(result).toBeNull();
  });

  it("handles missing artist credit", async () => {
    setMockResponse({
      recordings: [{ title: "Test Song" }]
    });
    const result = await searchMusic("test");
    expect(result?.artist).toBe("Unknown Artist");
    expect(result?.trackTitle).toBe("Test Song");
  });

  it("handles missing release info", async () => {
    setMockResponse({
      recordings: [{ title: "Loose Track", "artist-credit": [{ name: "Artist" }] }]
    });
    const result = await searchMusic("loose track");
    expect(result?.album).toBeUndefined();
    expect(result?.year).toBeUndefined();
  });
});

describe("searchAlbum", () => {
  it("returns album details from MusicBrainz", async () => {
    setMockResponse({
      releases: [{
        title: "Abbey Road",
        "artist-credit": [{ name: "The Beatles" }],
        date: "1969-09-26"
      }]
    });

    const result = await searchAlbum("Abbey Road", "The Beatles");
    expect(result).toEqual({
      artist: "The Beatles",
      album: "Abbey Road",
      year: 1969
    });
    expect(lastRequestUrl).toContain("AND%20artist");
  });

  it("searches without artist filter when not provided", async () => {
    setMockResponse({
      releases: [{ title: "Album", date: "2020-01-01" }]
    });
    const result = await searchAlbum("Album");
    expect(result?.artist).toBe("Unknown Artist");
    expect(lastRequestUrl).not.toContain("AND artist");
  });

  it("returns null when no releases found", async () => {
    setMockResponse({ releases: [] });
    const result = await searchAlbum("xyznonexistent");
    expect(result).toBeNull();
  });
});

// ── Open Library ───────────────────────────────────────────────────

describe("searchBook", () => {
  it("returns book details from Open Library", async () => {
    setMockResponse({
      docs: [{
        title: "The Great Gatsby",
        author_name: ["F. Scott Fitzgerald"],
        first_publish_year: 1925
      }]
    });

    const result = await searchBook("great gatsby");
    expect(result).toEqual({
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
      year: 1925
    });
    expect(lastRequestUrl).toContain("openlibrary.org");
  });

  it("returns null when no docs found", async () => {
    setMockResponse({ docs: [] });
    const result = await searchBook("xyznonexistent");
    expect(result).toBeNull();
  });

  it("handles missing author", async () => {
    setMockResponse({
      docs: [{ title: "Anonymous Work", first_publish_year: 1800 }]
    });
    const result = await searchBook("anonymous");
    expect(result?.author).toBe("Unknown Author");
  });

  it("handles missing publish year", async () => {
    setMockResponse({
      docs: [{ title: "Recent Book", author_name: ["Author"] }]
    });
    const result = await searchBook("recent");
    expect(result?.year).toBeUndefined();
  });
});

// ── needsLookup ────────────────────────────────────────────────────

describe("needsLookup", () => {
  it("returns true for TV show missing year", () => {
    const meta = baseMeta({ title: "The Simpsons", season: 1, episode: 1 });
    expect(needsLookup(meta, MediaType.JELLYFIN_TV)).toBe(true);
  });

  it("returns true for TV show with season/episode but no episode title", () => {
    const meta = baseMeta({ title: "Simpsons", season: 1, episode: 1, year: 1989 });
    expect(needsLookup(meta, MediaType.JELLYFIN_TV)).toBe(true);
  });

  it("returns false for fully enriched TV metadata", () => {
    const meta = baseMeta({ title: "The Simpsons", season: 1, episode: 1, year: 1989, episodeTitle: "Roasting" });
    expect(needsLookup(meta, MediaType.JELLYFIN_TV)).toBe(false);
  });

  it("returns true for movie with title same as baseName", () => {
    const meta = baseMeta({ title: "test" });
    expect(needsLookup(meta, MediaType.JELLYFIN_MOVIE)).toBe(true);
  });

  it("returns true for movie missing year", () => {
    const meta = baseMeta({ title: "Inception" });
    expect(needsLookup(meta, MediaType.JELLYFIN_MOVIE)).toBe(true);
  });

  it("returns false for fully enriched movie metadata", () => {
    const meta = baseMeta({ title: "Inception", year: 2010 });
    expect(needsLookup(meta, MediaType.JELLYFIN_MOVIE)).toBe(false);
  });

  it("returns true for music missing artist", () => {
    const meta = baseMeta({});
    expect(needsLookup(meta, MediaType.MUSIC)).toBe(true);
  });

  it("returns true for music with Unknown artist", () => {
    const meta = baseMeta({ artist: "Unknown" });
    expect(needsLookup(meta, MediaType.MUSIC)).toBe(true);
  });

  it("returns false for fully enriched music metadata", () => {
    const meta = baseMeta({ artist: "Queen", year: 1975 });
    expect(needsLookup(meta, MediaType.MUSIC)).toBe(false);
  });

  it("returns true for book missing author", () => {
    const meta = baseMeta({ title: "Gatsby" });
    expect(needsLookup(meta, MediaType.BOOKS)).toBe(true);
  });

  it("returns false for unsupported media types", () => {
    expect(needsLookup(baseMeta(), MediaType.PHOTOGRAPHY)).toBe(false);
    expect(needsLookup(baseMeta(), MediaType.EMULATION_ROMS)).toBe(false);
    expect(needsLookup(baseMeta(), MediaType.DATE_HIERARCHY)).toBe(false);
  });
});

// ── enrichMetadata ─────────────────────────────────────────────────

describe("enrichMetadata", () => {
  const enabledConfig: LookupConfig = {
    enabled: true,
    tmdbApiKey: "test-key",
    timeoutMs: 5_000
  };

  it("returns meta unchanged when lookups are disabled", async () => {
    const meta = baseMeta({ title: "test" });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE, { enabled: false });
    expect(result).toEqual(meta);
  });

  it("returns meta unchanged when no lookup needed", async () => {
    const meta = baseMeta({ title: "Inception", year: 2010 });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE, enabledConfig);
    expect(result).toEqual(meta);
  });

  it("enriches TV show metadata from TMDB", async () => {
    // First call: search TV
    let callCount = 0;
    const originalBody = mockResponseData.body;

    // Mock two sequential responses: TV search then episode lookup
    const responses = [
      JSON.stringify({ results: [{ id: 456, name: "The Simpsons", first_air_date: "1989-12-17" }] }),
      JSON.stringify({ name: "Simpsons Roasting on an Open Fire", season_number: 1, episode_number: 1, air_date: "1989-12-17" })
    ];

    const https = require("https");
    const origRequest = https.request;
    https.request = jest.fn((opts: any, cb: any) => {
      mockResponseData.body = responses[callCount] ?? "{}";
      callCount++;
      return origRequest(opts, cb);
    });

    const meta = baseMeta({ title: "simpsons", season: 1, episode: 1 });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_TV, enabledConfig);

    expect(result.title).toBe("The Simpsons");
    expect(result.year).toBe(1989);
    expect(result.episodeTitle).toBe("Simpsons Roasting on an Open Fire");

    https.request = origRequest;
    mockResponseData.body = originalBody;
  });

  it("enriches movie metadata from TMDB", async () => {
    setMockResponse({
      results: [{ id: 27205, title: "Inception", release_date: "2010-07-16" }]
    });

    const meta = baseMeta({ title: "inception" });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE, enabledConfig);

    expect(result.title).toBe("Inception");
    expect(result.year).toBe(2010);
  });

  it("enriches music metadata from MusicBrainz", async () => {
    setMockResponse({
      recordings: [{
        title: "Bohemian Rhapsody",
        "artist-credit": [{ name: "Queen" }],
        releases: [{ title: "A Night at the Opera", date: "1975-10-31" }]
      }]
    });

    const meta = baseMeta({ songTitle: "bohemian rhapsody", ext: ".flac" });
    const result = await enrichMetadata(meta, MediaType.MUSIC, enabledConfig);

    expect(result.artist).toBe("Queen");
    expect(result.album).toBe("A Night at the Opera");
    expect(result.year).toBe(1975);
  });

  it("enriches book metadata from Open Library", async () => {
    setMockResponse({
      docs: [{
        title: "The Great Gatsby",
        author_name: ["F. Scott Fitzgerald"],
        first_publish_year: 1925
      }]
    });

    const meta = baseMeta({ title: "gatsby", ext: ".epub" });
    const result = await enrichMetadata(meta, MediaType.BOOKS, enabledConfig);

    expect(result.title).toBe("The Great Gatsby");
    expect(result.artist).toBe("F. Scott Fitzgerald");
    expect(result.year).toBe(1925);
  });

  it("does not overwrite existing year when already set", async () => {
    setMockResponse({
      results: [{ id: 100, title: "The Correct Title", release_date: "2000-01-01" }]
    });

    const meta = baseMeta({ title: "test", year: 2005 });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE, enabledConfig);

    // API title replaces local title (authoritative), but year is preserved
    expect(result.title).toBe("The Correct Title");
    expect(result.year).toBe(2005);
  });

  it("skips TMDB lookup when no API key is provided", async () => {
    const noKeyConfig: LookupConfig = { enabled: true, tmdbApiKey: undefined };
    const meta = baseMeta({ title: "test" });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE, noKeyConfig);
    expect(result.title).toBe("test"); // unchanged
  });

  it("handles anime the same as TV (uses TMDB)", async () => {
    setMockResponse({
      results: [{ id: 100, name: "Naruto", first_air_date: "2002-10-03" }]
    });

    const meta = baseMeta({ title: "naruto", absoluteEpisode: 1 });
    const result = await enrichMetadata(meta, MediaType.ANIME, enabledConfig);

    expect(result.title).toBe("Naruto");
    expect(result.year).toBe(2002);
  });

  it("handles multi-version movie same as regular movie", async () => {
    setMockResponse({
      results: [{ id: 100, title: "Blade Runner 2049", release_date: "2017-10-06" }]
    });

    const meta = baseMeta({ title: "blade runner 2049" });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE_VERSION, enabledConfig);

    expect(result.title).toBe("Blade Runner 2049");
    expect(result.year).toBe(2017);
  });

  it("survives network errors gracefully", async () => {
    // Force a parse error
    mockResponseData.body = "";
    mockResponseData.statusCode = 500;

    const meta = baseMeta({ title: "test" });
    const result = await enrichMetadata(meta, MediaType.JELLYFIN_MOVIE, enabledConfig);

    // Should return meta unchanged, no crash
    expect(result.title).toBe("test");
  });
});
