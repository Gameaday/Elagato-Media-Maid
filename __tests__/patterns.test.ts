/**
 * Tests for src/lib/patterns.ts
 */

import {
  MediaType,
  sanitizeFilename,
  jellyfinTvPattern,
  jellyfinMoviePattern,
  photographyPattern,
  musicPattern,
  booksPattern,
  genericDocsPattern,
  getPattern,
  ALL_PATTERNS,
  type FileMetadata
} from "../src/lib/patterns";

const baseMetaTv: FileMetadata = {
  baseName: "Breaking Bad",
  ext: ".mkv",
  originalPath: "/media/tv/Breaking Bad - S01E01.mkv",
  title: "Breaking Bad",
  season: 1,
  episode: 1,
  episodeTitle: "Pilot"
};

describe("sanitizeFilename", () => {
  it("removes forbidden characters", () => {
    expect(sanitizeFilename("File: Name/\\*?\"<>|")).toBe("File_ Name________");
  });

  it("collapses multiple spaces", () => {
    expect(sanitizeFilename("hello   world")).toBe("hello world");
  });

  it("trims leading and trailing spaces", () => {
    expect(sanitizeFilename("  filename  ")).toBe("filename");
  });

  it("leaves clean strings unchanged", () => {
    expect(sanitizeFilename("Breaking Bad")).toBe("Breaking Bad");
  });
});

describe("jellyfinTvPattern", () => {
  it("formats with show, season, episode, and title", () => {
    const result = jellyfinTvPattern.format(baseMetaTv);
    expect(result).toBe("Breaking Bad - S01E01 - Pilot.mkv");
  });

  it("pads single-digit season and episode with zeros", () => {
    const meta = { ...baseMetaTv, season: 3, episode: 7 };
    expect(jellyfinTvPattern.format(meta)).toBe("Breaking Bad - S03E07 - Pilot.mkv");
  });

  it("handles double-digit season and episode", () => {
    const meta = { ...baseMetaTv, season: 12, episode: 24, episodeTitle: "Finale" };
    expect(jellyfinTvPattern.format(meta)).toBe("Breaking Bad - S12E24 - Finale.mkv");
  });

  it("omits episode title when not provided", () => {
    const meta = { ...baseMetaTv, episodeTitle: undefined };
    expect(jellyfinTvPattern.format(meta)).toBe("Breaking Bad - S01E01.mkv");
  });

  it("defaults to season 1 episode 1 when missing", () => {
    const meta = { ...baseMetaTv, season: undefined, episode: undefined, episodeTitle: undefined };
    expect(jellyfinTvPattern.format(meta)).toBe("Breaking Bad - S01E01.mkv");
  });

  it("generates the correct folder path", () => {
    const path = jellyfinTvPattern.folderPath!(baseMetaTv);
    expect(path).toBe("Breaking Bad/Season 01");
  });
});

describe("jellyfinMoviePattern", () => {
  const baseMeta: FileMetadata = {
    baseName: "Inception",
    ext: ".mkv",
    originalPath: "/media/movies/Inception (2010).mkv",
    title: "Inception",
    year: 2010
  };

  it("formats with title and year", () => {
    expect(jellyfinMoviePattern.format(baseMeta)).toBe("Inception (2010).mkv");
  });

  it("omits year when not provided", () => {
    const meta = { ...baseMeta, year: undefined };
    expect(jellyfinMoviePattern.format(meta)).toBe("Inception.mkv");
  });

  it("generates the correct folder path", () => {
    expect(jellyfinMoviePattern.folderPath!(baseMeta)).toBe("Inception (2010)");
  });
});

describe("photographyPattern", () => {
  it("formats with date, location, and index", () => {
    const meta: FileMetadata = {
      baseName: "IMG_4512",
      ext: ".jpg",
      originalPath: "/photos/IMG_4512.jpg",
      dateTaken: "2024-06-15",
      location: "Paris",
      index: 3
    };
    expect(photographyPattern.format(meta)).toBe("2024-06-15_Paris_003.jpg");
  });

  it("formats with date only when location and index are absent", () => {
    const meta: FileMetadata = {
      baseName: "IMG_0001",
      ext: ".jpg",
      originalPath: "/photos/IMG_0001.jpg",
      dateTaken: "2024-01-01"
    };
    expect(photographyPattern.format(meta)).toBe("2024-01-01.jpg");
  });
});

describe("musicPattern", () => {
  it("formats with track number, artist, and song title", () => {
    const meta: FileMetadata = {
      baseName: "01 - Artist - Song",
      ext: ".flac",
      originalPath: "/music/01 - Artist - Song.flac",
      trackNumber: 1,
      artist: "Led Zeppelin",
      songTitle: "Stairway to Heaven"
    };
    expect(musicPattern.format(meta)).toBe("01 - Led Zeppelin - Stairway to Heaven.flac");
  });

  it("uses Unknown Artist when artist is missing", () => {
    const meta: FileMetadata = {
      baseName: "Song",
      ext: ".mp3",
      originalPath: "/music/Song.mp3",
      trackNumber: 5,
      songTitle: "My Song"
    };
    expect(musicPattern.format(meta)).toBe("05 - Unknown Artist - My Song.mp3");
  });

  it("generates the correct folder path", () => {
    const meta: FileMetadata = {
      baseName: "track",
      ext: ".flac",
      originalPath: "/music/track.flac",
      artist: "Pink Floyd",
      album: "The Wall"
    };
    expect(musicPattern.folderPath!(meta)).toBe("Pink Floyd/The Wall");
  });
});

describe("booksPattern", () => {
  it("formats with author and title", () => {
    const meta: FileMetadata = {
      baseName: "Foundation",
      ext: ".epub",
      originalPath: "/books/Foundation.epub",
      artist: "Isaac Asimov",
      songTitle: "Foundation"
    };
    expect(booksPattern.format(meta)).toBe("Isaac Asimov - Foundation.epub");
  });
});

describe("genericDocsPattern", () => {
  it("prefixes with date", () => {
    const meta: FileMetadata = {
      baseName: "Meeting Notes",
      ext: ".pdf",
      originalPath: "/docs/Meeting Notes.pdf",
      dateTaken: "2024-03-01"
    };
    expect(genericDocsPattern.format(meta)).toBe("2024-03-01_Meeting Notes.pdf");
  });
});

describe("getPattern", () => {
  it("returns the correct pattern for each MediaType", () => {
    expect(getPattern(MediaType.JELLYFIN_TV)).toBe(jellyfinTvPattern);
    expect(getPattern(MediaType.JELLYFIN_MOVIE)).toBe(jellyfinMoviePattern);
    expect(getPattern(MediaType.PHOTOGRAPHY)).toBe(photographyPattern);
    expect(getPattern(MediaType.MUSIC)).toBe(musicPattern);
    expect(getPattern(MediaType.BOOKS)).toBe(booksPattern);
    expect(getPattern(MediaType.GENERIC_DOCS)).toBe(genericDocsPattern);
  });

  it("returns undefined for UNKNOWN", () => {
    expect(getPattern(MediaType.UNKNOWN)).toBeUndefined();
  });
});

describe("ALL_PATTERNS", () => {
  it("contains exactly 6 patterns", () => {
    expect(ALL_PATTERNS).toHaveLength(6);
  });

  it("all patterns have non-empty extension lists", () => {
    for (const pattern of ALL_PATTERNS) {
      expect(pattern.extensions.length).toBeGreaterThan(0);
    }
  });
});
