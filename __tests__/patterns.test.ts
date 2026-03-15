/**
 * Tests for src/lib/patterns.ts
 */

import {
  MediaType,
  sanitizeFilename,
  jellyfinTvPattern,
  jellyfinMoviePattern,
  jellyfinMovieVersionPattern,
  photographyPattern,
  musicPattern,
  booksPattern,
  genericDocsPattern,
  emulationRomsPattern,
  getPattern,
  ALL_PATTERNS,
  applyTemplate,
  createCustomPattern,
  DEFAULT_CUSTOM_TEMPLATE,
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

  it("includes album year in folder path when available", () => {
    const meta: FileMetadata = {
      baseName: "track",
      ext: ".flac",
      originalPath: "/music/track.flac",
      artist: "Pink Floyd",
      album: "The Wall",
      year: 1979
    };
    expect(musicPattern.folderPath!(meta)).toBe("Pink Floyd/The Wall (1979)");
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

  it("formats with author, title, and year", () => {
    const meta: FileMetadata = {
      baseName: "Foundation",
      ext: ".epub",
      originalPath: "/books/Foundation.epub",
      artist: "Isaac Asimov",
      songTitle: "Foundation",
      year: 1951
    };
    expect(booksPattern.format(meta)).toBe("Isaac Asimov - Foundation (1951).epub");
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
    expect(getPattern(MediaType.JELLYFIN_MOVIE_VERSION)).toBe(jellyfinMovieVersionPattern);
    expect(getPattern(MediaType.PHOTOGRAPHY)).toBe(photographyPattern);
    expect(getPattern(MediaType.MUSIC)).toBe(musicPattern);
    expect(getPattern(MediaType.BOOKS)).toBe(booksPattern);
    expect(getPattern(MediaType.GENERIC_DOCS)).toBe(genericDocsPattern);
    expect(getPattern(MediaType.EMULATION_ROMS)).toBe(emulationRomsPattern);
  });

  it("returns undefined for UNKNOWN", () => {
    expect(getPattern(MediaType.UNKNOWN)).toBeUndefined();
  });
});

describe("ALL_PATTERNS", () => {
  it("contains exactly 8 patterns", () => {
    expect(ALL_PATTERNS).toHaveLength(8);
  });

  it("all patterns have non-empty extension lists", () => {
    for (const pattern of ALL_PATTERNS) {
      expect(pattern.extensions.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Custom Template Pattern
// ---------------------------------------------------------------------------

describe("applyTemplate", () => {
  it("replaces TV tokens", () => {
    const result = applyTemplate("{title} - S{season}E{episode} - {episodeTitle}{ext}", baseMetaTv);
    expect(result).toBe("Breaking Bad - S01E01 - Pilot.mkv");
  });

  it("replaces music tokens", () => {
    const meta: FileMetadata = {
      baseName: "track",
      ext: ".flac",
      originalPath: "/music/track.flac",
      trackNumber: 3,
      artist: "Pink Floyd",
      songTitle: "Comfortably Numb"
    };
    const result = applyTemplate("{track} - {artist} - {song}{ext}", meta);
    expect(result).toBe("03 - Pink Floyd - Comfortably Numb.flac");
  });

  it("replaces photo tokens", () => {
    const meta: FileMetadata = {
      baseName: "IMG_001",
      ext: ".jpg",
      originalPath: "/photos/IMG_001.jpg",
      dateTaken: "2024-06-15",
      location: "Paris",
      index: 5
    };
    const result = applyTemplate("{date}_{location}_{index}{ext}", meta);
    expect(result).toBe("2024-06-15_Paris_005.jpg");
  });

  it("returns empty string for missing date token", () => {
    const meta: FileMetadata = {
      baseName: "file",
      ext: ".jpg",
      originalPath: "/photos/file.jpg"
    };
    const result = applyTemplate("{date}{ext}", meta);
    expect(result).toBe(".jpg");
  });

  it("leaves unknown tokens unchanged", () => {
    const result = applyTemplate("{unknownToken}{ext}", baseMetaTv);
    expect(result).toBe("{unknownToken}.mkv");
  });

  it("uses baseName when title is missing", () => {
    const meta: FileMetadata = {
      baseName: "my file",
      ext: ".txt",
      originalPath: "/docs/my file.txt"
    };
    const result = applyTemplate("{title}{ext}", meta);
    expect(result).toBe("my file.txt");
  });

  it("produces empty string for missing optional tokens", () => {
    const meta: FileMetadata = {
      baseName: "file",
      ext: ".mkv",
      originalPath: "/media/file.mkv",
      title: "Show"
    };
    const result = applyTemplate("{title} - S{season}E{episode}{ext}", meta);
    expect(result).toBe("Show - SE.mkv");
  });

  it("replaces year token", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010
    };
    const result = applyTemplate("{title} ({year}){ext}", meta);
    expect(result).toBe("Inception (2010).mkv");
  });

  it("uses baseName token", () => {
    const meta: FileMetadata = {
      baseName: "original_filename",
      ext: ".pdf",
      originalPath: "/docs/original_filename.pdf"
    };
    const result = applyTemplate("{baseName}{ext}", meta);
    expect(result).toBe("original_filename.pdf");
  });
});

describe("createCustomPattern", () => {
  it("creates a pattern with the CUSTOM media type", () => {
    const pattern = createCustomPattern("{title}{ext}");
    expect(pattern.mediaType).toBe(MediaType.CUSTOM);
    expect(pattern.label).toBe("Custom Template");
  });

  it("formats using the provided template", () => {
    const pattern = createCustomPattern("{title} - S{season}E{episode}{ext}");
    const result = pattern.format(baseMetaTv);
    expect(result).toBe("Breaking Bad - S01E01.mkv");
  });

  it("has extensions covering all media types", () => {
    const pattern = createCustomPattern("{title}{ext}");
    expect(pattern.extensions).toContain(".mkv");
    expect(pattern.extensions).toContain(".jpg");
    expect(pattern.extensions).toContain(".flac");
    expect(pattern.extensions).toContain(".epub");
    expect(pattern.extensions).toContain(".pdf");
  });

  it("does not have duplicate extensions", () => {
    const pattern = createCustomPattern("{title}{ext}");
    const unique = new Set(pattern.extensions);
    expect(unique.size).toBe(pattern.extensions.length);
  });
});

describe("DEFAULT_CUSTOM_TEMPLATE", () => {
  it("is a valid template string with tokens", () => {
    expect(DEFAULT_CUSTOM_TEMPLATE).toContain("{title}");
    expect(DEFAULT_CUSTOM_TEMPLATE).toContain("{ext}");
  });
});

// ---------------------------------------------------------------------------
// Emulation ROMs Pattern
// ---------------------------------------------------------------------------

describe("emulationRomsPattern", () => {
  it("formats with title and region", () => {
    const meta: FileMetadata = {
      baseName: "Super Mario Bros",
      ext: ".nes",
      originalPath: "/roms/Super Mario Bros.nes",
      title: "Super Mario Bros",
      region: "USA"
    };
    expect(emulationRomsPattern.format(meta)).toBe("Super Mario Bros (USA).nes");
  });

  it("formats without region when not provided", () => {
    const meta: FileMetadata = {
      baseName: "Sonic",
      ext: ".gen",
      originalPath: "/roms/Sonic.gen",
      title: "Sonic"
    };
    expect(emulationRomsPattern.format(meta)).toBe("Sonic.gen");
  });

  it("falls back to baseName when title is missing", () => {
    const meta: FileMetadata = {
      baseName: "unknown_rom",
      ext: ".sfc",
      originalPath: "/roms/unknown_rom.sfc"
    };
    expect(emulationRomsPattern.format(meta)).toBe("unknown_rom.sfc");
  });

  it("generates platform folder path from extension", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".nes",
      originalPath: "/roms/game.nes"
    };
    expect(emulationRomsPattern.folderPath!(meta)).toBe("NES");
  });

  it("generates SNES folder for .sfc extension", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".sfc",
      originalPath: "/roms/game.sfc"
    };
    expect(emulationRomsPattern.folderPath!(meta)).toBe("SNES");
  });

  it("generates Game Boy Advance folder for .gba extension", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".gba",
      originalPath: "/roms/game.gba"
    };
    expect(emulationRomsPattern.folderPath!(meta)).toBe("Game Boy Advance");
  });

  it("uses platform from metadata when available", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".chd",
      originalPath: "/roms/game.chd",
      platform: "PlayStation"
    };
    expect(emulationRomsPattern.folderPath!(meta)).toBe("PlayStation");
  });

  it("falls back to Other for unknown extension", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".xyz",
      originalPath: "/roms/game.xyz"
    };
    expect(emulationRomsPattern.folderPath!(meta)).toBe("Other");
  });

  it("has ROM-specific extensions", () => {
    expect(emulationRomsPattern.extensions).toContain(".nes");
    expect(emulationRomsPattern.extensions).toContain(".sfc");
    expect(emulationRomsPattern.extensions).toContain(".gba");
    expect(emulationRomsPattern.extensions).toContain(".n64");
    expect(emulationRomsPattern.extensions).toContain(".gen");
  });

  it("has mediaType EMULATION_ROMS", () => {
    expect(emulationRomsPattern.mediaType).toBe(MediaType.EMULATION_ROMS);
  });
});

// ---------------------------------------------------------------------------
// Jellyfin Movie Multi-Version Pattern
// ---------------------------------------------------------------------------

describe("jellyfinMovieVersionPattern", () => {
  it("formats with title, year, and resolution", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010,
      resolution: "1080p"
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception (2010) - [1080p].mkv");
  });

  it("normalises 2160p to 4K", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010,
      resolution: "2160p",
      versionTag: "4K"
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception (2010) - [4K].mkv");
  });

  it("omits resolution tag when not provided", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception (2010).mkv");
  });

  it("omits year when not provided", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      resolution: "720p"
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception - [720p].mkv");
  });

  it("generates the correct folder path", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010,
      resolution: "1080p"
    };
    expect(jellyfinMovieVersionPattern.folderPath!(meta)).toBe("Inception (2010)");
  });

  it("has mediaType JELLYFIN_MOVIE_VERSION", () => {
    expect(jellyfinMovieVersionPattern.mediaType).toBe(MediaType.JELLYFIN_MOVIE_VERSION);
  });

  it("uses TV_VIDEO_EXTENSIONS", () => {
    expect(jellyfinMovieVersionPattern.extensions).toContain(".mkv");
    expect(jellyfinMovieVersionPattern.extensions).toContain(".mp4");
  });
});

// ---------------------------------------------------------------------------
// applyTemplate – platform and region tokens
// ---------------------------------------------------------------------------

describe("applyTemplate – ROM tokens", () => {
  it("replaces {platform} token", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".nes",
      originalPath: "/roms/game.nes",
      platform: "NES"
    };
    const result = applyTemplate("{platform}/{title}{ext}", meta);
    expect(result).toBe("NES/game.nes");
  });

  it("replaces {region} token", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".sfc",
      originalPath: "/roms/game.sfc",
      title: "Zelda",
      region: "Japan"
    };
    const result = applyTemplate("{title} ({region}){ext}", meta);
    expect(result).toBe("Zelda (Japan).sfc");
  });

  it("returns empty string for missing platform", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".bin",
      originalPath: "/roms/game.bin"
    };
    const result = applyTemplate("{platform}{ext}", meta);
    expect(result).toBe(".bin");
  });

  it("returns empty string for missing region", () => {
    const meta: FileMetadata = {
      baseName: "game",
      ext: ".nes",
      originalPath: "/roms/game.nes"
    };
    const result = applyTemplate("{region}{ext}", meta);
    expect(result).toBe(".nes");
  });
});

// ---------------------------------------------------------------------------
// applyTemplate – resolution and album tokens
// ---------------------------------------------------------------------------

describe("applyTemplate – resolution and album tokens", () => {
  it("replaces {resolution} token", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv",
      title: "Inception",
      resolution: "1080p"
    };
    const result = applyTemplate("{title} - [{resolution}]{ext}", meta);
    expect(result).toBe("Inception - [1080p].mkv");
  });

  it("returns empty string for missing resolution", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv"
    };
    const result = applyTemplate("{resolution}{ext}", meta);
    expect(result).toBe(".mkv");
  });

  it("replaces {album} token", () => {
    const meta: FileMetadata = {
      baseName: "track",
      ext: ".flac",
      originalPath: "/music/track.flac",
      album: "The Wall"
    };
    const result = applyTemplate("{album}{ext}", meta);
    expect(result).toBe("The Wall.flac");
  });

  it("returns empty string for missing album", () => {
    const meta: FileMetadata = {
      baseName: "track",
      ext: ".flac",
      originalPath: "/music/track.flac"
    };
    const result = applyTemplate("{album}{ext}", meta);
    expect(result).toBe(".flac");
  });
});

// ---------------------------------------------------------------------------
// applyTemplate – source, hdr, versionTag tokens
// ---------------------------------------------------------------------------

describe("applyTemplate – quality tokens", () => {
  it("replaces {source} token", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv",
      source: "Bluray"
    };
    const result = applyTemplate("{title} [{source}]{ext}", meta);
    expect(result).toBe("movie [Bluray].mkv");
  });

  it("replaces {hdr} token", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv",
      hdr: "HDR10"
    };
    const result = applyTemplate("{title} [{hdr}]{ext}", meta);
    expect(result).toBe("movie [HDR10].mkv");
  });

  it("replaces {versionTag} token", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv",
      versionTag: "4K Bluray Remux HDR"
    };
    const result = applyTemplate("{title} - [{versionTag}]{ext}", meta);
    expect(result).toBe("movie - [4K Bluray Remux HDR].mkv");
  });

  it("returns empty string for missing source", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv"
    };
    const result = applyTemplate("{source}", meta);
    expect(result).toBe("");
  });

  it("returns empty string for missing hdr", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv"
    };
    const result = applyTemplate("{hdr}", meta);
    expect(result).toBe("");
  });

  it("returns empty string for missing versionTag", () => {
    const meta: FileMetadata = {
      baseName: "movie",
      ext: ".mkv",
      originalPath: "/movies/movie.mkv"
    };
    const result = applyTemplate("{versionTag}", meta);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// jellyfinMovieVersionPattern – enhanced version tags
// ---------------------------------------------------------------------------

describe("jellyfinMovieVersionPattern – enhanced version tags", () => {
  it("uses full version tag when available", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010,
      resolution: "1080p",
      source: "Bluray",
      versionTag: "1080p Bluray"
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception (2010) - [1080p Bluray].mkv");
  });

  it("falls back to resolution when no version tag", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010,
      resolution: "1080p"
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception (2010) - [1080p].mkv");
  });

  it("includes HDR in version tag", () => {
    const meta: FileMetadata = {
      baseName: "Inception",
      ext: ".mkv",
      originalPath: "/movies/Inception.mkv",
      title: "Inception",
      year: 2010,
      versionTag: "4K Bluray Remux HDR"
    };
    expect(jellyfinMovieVersionPattern.format(meta)).toBe("Inception (2010) - [4K Bluray Remux HDR].mkv");
  });
});
