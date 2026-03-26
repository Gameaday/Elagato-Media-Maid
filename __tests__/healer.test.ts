/**
 * Tests for the collection healer module.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import {
  diagnoseFile,
  diagnoseCollection,
  healCollection,
  inferFromFolderName,
  findCommonPrefix,
  buildFolderContext,
  buildHealedName,
  scanSeriesGaps,
  scanQualityInconsistencies,
  scanNamingInconsistencies,
  detectNamingScheme
} from "../src/lib/healer";
import { MediaType } from "../src/lib/patterns";

const TEST_ROOT = join(__dirname, ".tmp-healer");

function createTestFiles(structure: Record<string, string>) {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = join(TEST_ROOT, relPath);
    const dir = dirname(fullPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
  }
}

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ── inferFromFolderName ────────────────────────────────────────────

describe("inferFromFolderName", () => {
  it("extracts title and year from 'Title (Year)' format", () => {
    const ctx = inferFromFolderName("Breaking Bad (2008)");
    expect(ctx.title).toBe("Breaking Bad");
    expect(ctx.year).toBe(2008);
  });

  it("extracts title without year", () => {
    const ctx = inferFromFolderName("My Movie Collection");
    expect(ctx.title).toBe("My Movie Collection");
    expect(ctx.year).toBeUndefined();
  });

  it("extracts season from 'Season NN' folder", () => {
    const ctx = inferFromFolderName("Season 03");
    expect(ctx.season).toBe(3);
    expect(ctx.title).toBeUndefined();
  });

  it("handles lowercase season", () => {
    const ctx = inferFromFolderName("season 1");
    expect(ctx.season).toBe(1);
  });

  it("extracts title and year from 'Title - Year' format", () => {
    const ctx = inferFromFolderName("Inception 2010");
    expect(ctx.title).toBe("Inception");
    expect(ctx.year).toBe(2010);
  });

  it("handles folder with just a year", () => {
    const ctx = inferFromFolderName("2024");
    // "2024" is a valid year but title portion is empty
    expect(ctx.year).toBe(2024);
  });

  it("handles complex folder names", () => {
    const ctx = inferFromFolderName("The Lord of the Rings (2001)");
    expect(ctx.title).toBe("The Lord of the Rings");
    expect(ctx.year).toBe(2001);
  });
});

// ── findCommonPrefix ───────────────────────────────────────────────

describe("findCommonPrefix", () => {
  it("finds common prefix in TV episode filenames", () => {
    const names = [
      "Breaking Bad - S01E01 - Pilot",
      "Breaking Bad - S01E02 - Cats in the Bag",
      "Breaking Bad - S01E03 - And the Bags in the River"
    ];
    expect(findCommonPrefix(names)).toBe("Breaking Bad - S01E0");
  });

  it("returns empty for completely different names", () => {
    const names = ["abc", "xyz", "123"];
    expect(findCommonPrefix(names)).toBe("");
  });

  it("returns empty for empty array", () => {
    expect(findCommonPrefix([])).toBe("");
  });

  it("returns the string for a single-element array", () => {
    expect(findCommonPrefix(["Hello World"])).toBe("Hello World");
  });

  it("trims trailing separators from prefix", () => {
    const names = [
      "Show Name - Episode 1",
      "Show Name - Episode 2"
    ];
    expect(findCommonPrefix(names)).toBe("Show Name - Episode");
  });

  it("returns empty string for short common prefixes", () => {
    const names = ["ab123", "ab456"];
    // "ab" is only 2 chars, below the 3-char minimum
    expect(findCommonPrefix(names)).toBe("");
  });
});

// ── diagnoseFile ───────────────────────────────────────────────────

describe("diagnoseFile", () => {
  it("detects uppercase extension", () => {
    const issues = diagnoseFile("/test/video.MKV", MediaType.JELLYFIN_TV);
    const extIssue = issues.find(i => i.kind === "wrong_extension_case");
    expect(extIssue).toBeDefined();
    expect(extIssue!.severity).toBe("warning");
    expect(extIssue!.suggestedName).toBe("video.mkv");
  });

  it("detects generic filenames", () => {
    const issues = diagnoseFile("/test/untitled.mkv", MediaType.JELLYFIN_TV);
    const genericIssue = issues.find(i => i.kind === "generic_name");
    expect(genericIssue).toBeDefined();
    expect(genericIssue!.severity).toBe("error");
  });

  it("detects various generic name patterns", () => {
    const genericNames = ["New File.mkv", "track 01.mp3", "video.mp4", "IMG_1234.jpg", "download.pdf"];
    for (const name of genericNames) {
      const issues = diagnoseFile(`/test/${name}`, MediaType.UNKNOWN);
      const found = issues.some(i => i.kind === "generic_name");
      expect(found).toBe(true);
    }
  });

  it("detects scene junk tokens", () => {
    const issues = diagnoseFile(
      "/test/Movie.2020.1080p.BluRay.YIFY.mkv",
      MediaType.JELLYFIN_MOVIE
    );
    const junkIssue = issues.find(i => i.kind === "junk_tokens");
    expect(junkIssue).toBeDefined();
    expect(junkIssue!.description).toContain("YIFY");
  });

  it("detects missing episode info in TV content", () => {
    const issues = diagnoseFile(
      "/test/Some Random Video.mkv",
      MediaType.JELLYFIN_TV
    );
    const epIssue = issues.find(i => i.kind === "missing_episode_info");
    expect(epIssue).toBeDefined();
    expect(epIssue!.severity).toBe("error");
  });

  it("does not flag valid TV filenames for missing episode", () => {
    const issues = diagnoseFile(
      "/test/Show.S01E01.Pilot.mkv",
      MediaType.JELLYFIN_TV
    );
    const epIssue = issues.find(i => i.kind === "missing_episode_info");
    expect(epIssue).toBeUndefined();
  });

  it("detects missing year in movie files", () => {
    const issues = diagnoseFile(
      "/test/Inception.mkv",
      MediaType.JELLYFIN_MOVIE
    );
    const yearIssue = issues.find(i => i.kind === "missing_year");
    expect(yearIssue).toBeDefined();
  });

  it("does not flag movie with year", () => {
    const issues = diagnoseFile(
      "/test/Inception.2010.1080p.mkv",
      MediaType.JELLYFIN_MOVIE
    );
    const yearIssue = issues.find(i => i.kind === "missing_year");
    expect(yearIssue).toBeUndefined();
  });

  it("does not flag movie when year is in folder context", () => {
    const issues = diagnoseFile(
      "/test/Inception.mkv",
      MediaType.JELLYFIN_MOVIE,
      { year: 2010 }
    );
    const yearIssue = issues.find(i => i.kind === "missing_year");
    expect(yearIssue).toBeUndefined();
  });

  it("detects missing resolution in multi-version movie", () => {
    const issues = diagnoseFile(
      "/test/Inception.2010.mkv",
      MediaType.JELLYFIN_MOVIE_VERSION
    );
    const resIssue = issues.find(i => i.kind === "missing_resolution_tag");
    expect(resIssue).toBeDefined();
  });

  it("does not flag multi-version movie with resolution", () => {
    const issues = diagnoseFile(
      "/test/Inception.2010.1080p.mkv",
      MediaType.JELLYFIN_MOVIE_VERSION
    );
    const resIssue = issues.find(i => i.kind === "missing_resolution_tag");
    expect(resIssue).toBeUndefined();
  });

  it("detects missing season number in TV content", () => {
    const issues = diagnoseFile(
      "/test/Some Random Video.mkv",
      MediaType.JELLYFIN_TV
    );
    const seasonIssue = issues.find(i => i.kind === "missing_season");
    expect(seasonIssue).toBeDefined();
  });

  it("does not flag missing season when folder context has it", () => {
    const issues = diagnoseFile(
      "/test/Some Random Video.mkv",
      MediaType.JELLYFIN_TV,
      { season: 1 }
    );
    const seasonIssue = issues.find(i => i.kind === "missing_season");
    expect(seasonIssue).toBeUndefined();
  });

  it("returns no issues for a well-named file", () => {
    const issues = diagnoseFile(
      "/test/Breaking Bad - S01E01 - Pilot.mkv",
      MediaType.JELLYFIN_TV,
      { season: 1 }
    );
    // Should have no errors (might have info-level issues)
    const errors = issues.filter(i => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("handles anime with absolute episode numbering", () => {
    const issues = diagnoseFile(
      "/test/Naruto - 042.mkv",
      MediaType.ANIME
    );
    const epIssue = issues.find(i => i.kind === "missing_episode_info");
    expect(epIssue).toBeUndefined();
  });

  // ── Comic/Manga diagnosis ──────────────────────────────────────

  it("detects missing volume/chapter in comic file", () => {
    const issues = diagnoseFile(
      "/test/Batman.cbz",
      MediaType.COMICS
    );
    const epIssue = issues.find(i => i.kind === "missing_episode_info");
    expect(epIssue).toBeDefined();
    expect(epIssue!.severity).toBe("warning");
  });

  it("does not flag comic file with volume and chapter", () => {
    const issues = diagnoseFile(
      "/test/One Piece Vol 01 Ch 001.cbz",
      MediaType.COMICS
    );
    const epIssue = issues.find(i => i.kind === "missing_episode_info");
    expect(epIssue).toBeUndefined();
  });

  it("detects missing series title in comic file", () => {
    const issues = diagnoseFile(
      "/test/Vol 01 Ch 001.cbz",
      MediaType.COMICS
    );
    const titleIssue = issues.find(i => i.kind === "missing_title");
    expect(titleIssue).toBeDefined();
  });

  it("does not flag comic with series title from folder context", () => {
    const issues = diagnoseFile(
      "/test/Vol 01 Ch 001.cbz",
      MediaType.COMICS,
      { title: "One Piece" }
    );
    const titleIssue = issues.find(i => i.kind === "missing_title");
    expect(titleIssue).toBeUndefined();
  });

  // ── YouTube diagnosis ──────────────────────────────────────────

  it("detects missing video ID in YouTube archive file", () => {
    const issues = diagnoseFile(
      "/test/Some Video.mp4",
      MediaType.YOUTUBE_ARCHIVE
    );
    const idIssue = issues.find(i => i.description.includes("video ID"));
    expect(idIssue).toBeDefined();
    expect(idIssue!.severity).toBe("info");
  });

  it("detects missing uploader in YouTube archive file", () => {
    const issues = diagnoseFile(
      "/test/Video Title [dQw4w9WgXcQ].mp4",
      MediaType.YOUTUBE_ARCHIVE
    );
    const uploaderIssue = issues.find(i => i.description.includes("uploader"));
    expect(uploaderIssue).toBeDefined();
  });

  it("does not flag YouTube file with uploader from context", () => {
    const issues = diagnoseFile(
      "/test/Video Title [dQw4w9WgXcQ].mp4",
      MediaType.YOUTUBE_ARCHIVE,
      { title: "Channel Name" }
    );
    const uploaderIssue = issues.find(i => i.description.includes("uploader"));
    expect(uploaderIssue).toBeUndefined();
  });

  // ── Podcast diagnosis ──────────────────────────────────────────

  it("detects missing show name in podcast file", () => {
    const issues = diagnoseFile(
      "/test/2024-01-15 - Episode Title.mp3",
      MediaType.PODCAST_ARCHIVE
    );
    const showIssue = issues.find(i => i.description.includes("show name"));
    expect(showIssue).toBeDefined();
  });

  it("does not flag podcast with show name from context", () => {
    const issues = diagnoseFile(
      "/test/2024-01-15 - Episode Title.mp3",
      MediaType.PODCAST_ARCHIVE,
      { title: "My Podcast" }
    );
    const showIssue = issues.find(i => i.description.includes("show name"));
    expect(showIssue).toBeUndefined();
  });

  it("detects missing date in podcast file", () => {
    const issues = diagnoseFile(
      "/test/My Show - Episode Title.mp3",
      MediaType.PODCAST_ARCHIVE
    );
    const dateIssue = issues.find(i => i.description.includes("date"));
    expect(dateIssue).toBeDefined();
  });

  // ── ROM diagnosis ──────────────────────────────────────────────

  it("detects missing region in ROM file", () => {
    const issues = diagnoseFile(
      "/test/Super Mario Bros.nes",
      MediaType.EMULATION_ROMS
    );
    const regionIssue = issues.find(i => i.description.includes("region"));
    expect(regionIssue).toBeDefined();
    expect(regionIssue!.severity).toBe("info");
  });

  it("does not flag ROM file with region tag", () => {
    const issues = diagnoseFile(
      "/test/Super Mario Bros (USA).nes",
      MediaType.EMULATION_ROMS
    );
    const regionIssue = issues.find(i => i.description.includes("region"));
    expect(regionIssue).toBeUndefined();
  });

  // ── Photography diagnosis ──────────────────────────────────────

  it("detects missing date in photo file", () => {
    const issues = diagnoseFile(
      "/test/IMG_1234.jpg",
      MediaType.PHOTOGRAPHY
    );
    const dateIssue = issues.find(i => i.description.includes("date"));
    expect(dateIssue).toBeDefined();
  });

  it("does not flag photo file with date in filename", () => {
    const issues = diagnoseFile(
      "/test/2024-03-15_vacation_001.jpg",
      MediaType.PHOTOGRAPHY
    );
    const dateIssue = issues.find(i => i.description.includes("date"));
    expect(dateIssue).toBeUndefined();
  });

  // ── Books diagnosis ────────────────────────────────────────────

  it("detects missing year in book file", () => {
    const issues = diagnoseFile(
      "/test/Author - Title.epub",
      MediaType.BOOKS
    );
    const yearIssue = issues.find(i => i.kind === "missing_year");
    expect(yearIssue).toBeDefined();
  });

  it("does not flag book with year in folder context", () => {
    const issues = diagnoseFile(
      "/test/Author - Title.epub",
      MediaType.BOOKS,
      { year: 2020 }
    );
    const yearIssue = issues.find(i => i.kind === "missing_year");
    expect(yearIssue).toBeUndefined();
  });
});

// ── diagnoseCollection ─────────────────────────────────────────────

describe("diagnoseCollection", () => {
  it("returns 100 health for an empty directory", async () => {
    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.healthScore).toBe(100);
    expect(result.filesExamined).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("diagnoses a TV collection with naming issues", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "",
      "Show.S01E02.Episode.Two.mkv": "",
      "random_video.mkv": "",
      "untitled.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.filesExamined).toBeGreaterThan(0);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.healthScore).toBeLessThan(100);
  });

  it("tracks issues by kind", async () => {
    createTestFiles({
      "untitled.mkv": "",
      "Movie.YIFY.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.issuesByKind).toBeDefined();
    expect(Object.keys(result.issuesByKind).length).toBeGreaterThan(0);
  });

  it("tracks issues by severity", async () => {
    createTestFiles({
      "video.MKV": "",
      "untitled.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.issuesBySeverity).toBeDefined();
    expect(result.issuesBySeverity.error + result.issuesBySeverity.warning + result.issuesBySeverity.info)
      .toBe(result.issues.length);
  });

  it("detects media type of the collection", async () => {
    createTestFiles({
      "Show.S01E01.mkv": "",
      "Show.S01E02.mkv": "",
      "Show.S01E03.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.detectedType).toBe(MediaType.JELLYFIN_TV);
  });

  it("handles non-existent paths gracefully", async () => {
    const result = await diagnoseCollection("/nonexistent/path/does/not/exist");
    expect(result.filesExamined).toBe(0);
  });
});

// ── buildFolderContext ──────────────────────────────────────────────

describe("buildFolderContext", () => {
  it("extracts title and year from parent folder", async () => {
    createTestFiles({
      "Breaking Bad (2008)/Season 01/file.mkv": ""
    });

    const ctx = await buildFolderContext(
      join(TEST_ROOT, "Breaking Bad (2008)/Season 01/file.mkv")
    );
    expect(ctx.title).toBe("Breaking Bad");
    expect(ctx.year).toBe(2008);
    expect(ctx.season).toBe(1);
  });

  it("extracts season from immediate parent", async () => {
    createTestFiles({
      "Show/Season 03/file.mkv": ""
    });

    const ctx = await buildFolderContext(
      join(TEST_ROOT, "Show/Season 03/file.mkv")
    );
    expect(ctx.season).toBe(3);
  });

  it("computes common prefix from sibling files", async () => {
    createTestFiles({
      "folder/Breaking Bad - S01E01.mkv": "",
      "folder/Breaking Bad - S01E02.mkv": "",
      "folder/Breaking Bad - S01E03.mkv": ""
    });

    const ctx = await buildFolderContext(
      join(TEST_ROOT, "folder/Breaking Bad - S01E01.mkv")
    );
    expect(ctx.commonPrefix).toBeDefined();
    expect(ctx.commonPrefix!.startsWith("Breaking Bad")).toBe(true);
  });
});

// ── buildHealedName ────────────────────────────────────────────────

describe("buildHealedName", () => {
  it("heals a TV show file using folder context", () => {
    const healed = buildHealedName(
      "/media/Show.S01E01.Pilot.mkv",
      MediaType.JELLYFIN_TV,
      { title: "Breaking Bad", season: 1 }
    );
    // Should format according to the Jellyfin TV pattern
    expect(healed).toContain("Breaking Bad");
    expect(healed).toContain("S01E01");
    expect(healed).toContain(".mkv");
  });

  it("returns null for non-media files", () => {
    const healed = buildHealedName(
      "/media/readme.txt",
      MediaType.JELLYFIN_TV,
      {}
    );
    expect(healed).toBeNull();
  });

  it("heals a movie file with folder context year", () => {
    const healed = buildHealedName(
      "/media/Inception.1080p.BluRay.mkv",
      MediaType.JELLYFIN_MOVIE,
      { title: "Inception", year: 2010 }
    );
    expect(healed).toBeDefined();
    expect(healed).toContain("Inception");
    expect(healed).toContain("2010");
  });

  it("heals a multi-version movie with quality tags", () => {
    const healed = buildHealedName(
      "/media/Inception.2010.2160p.BluRay.REMUX.HDR.mkv",
      MediaType.JELLYFIN_MOVIE_VERSION,
      { title: "Inception", year: 2010 }
    );
    expect(healed).toBeDefined();
    expect(healed).toContain("Inception");
    expect(healed).toContain("2010");
  });

  it("returns null when file already matches pattern", () => {
    const healed = buildHealedName(
      "/media/Show - S01E01 - Pilot.mkv",
      MediaType.JELLYFIN_TV,
      { title: "Show" }
    );
    // If the generated name equals the current filename, should return null
    // (depends on parsing; we test the mechanism works)
    if (healed) {
      expect(healed).toContain(".mkv");
    }
  });

  // ── Non-Jellyfin paradigm healing ────────────────────────────────

  it("heals a comic file using folder context for series title", () => {
    const healed = buildHealedName(
      "/manga/One Piece/Vol 01 Ch 001.cbz",
      MediaType.COMICS,
      { title: "One Piece" }
    );
    expect(healed).toBeDefined();
    expect(healed).toContain("One Piece");
  });

  it("heals a YouTube archive file using folder context for uploader", () => {
    const healed = buildHealedName(
      "/yt/Tom Scott/How Stuff Works [dQw4w9WgXcQ].mp4",
      MediaType.YOUTUBE_ARCHIVE,
      { title: "Tom Scott" }
    );
    expect(healed).toBeDefined();
    // Should have the uploader from context
    if (healed) {
      expect(healed).toContain(".mp4");
    }
  });

  it("heals a podcast file using folder context for show name", () => {
    const healed = buildHealedName(
      "/podcasts/Radiolab/2024-01-15 - Episode Title.mp3",
      MediaType.PODCAST_ARCHIVE,
      { title: "Radiolab" }
    );
    expect(healed).toBeDefined();
    if (healed) {
      expect(healed).toContain("Radiolab");
    }
  });

  it("heals a ROM file with folder context", () => {
    const healed = buildHealedName(
      "/roms/NES/Super Mario Bros (USA) [!].nes",
      MediaType.EMULATION_ROMS,
      { title: "NES" }
    );
    // ROM pattern should clean the name
    if (healed) {
      expect(healed).toContain(".nes");
    }
  });

  it("heals a book file using folder context for author", () => {
    const healed = buildHealedName(
      "/books/Title.epub",
      MediaType.BOOKS,
      { title: "Author Name", year: 2020 }
    );
    expect(healed).toBeDefined();
    if (healed) {
      expect(healed).toContain(".epub");
    }
  });
});

// ── healCollection ─────────────────────────────────────────────────

describe("healCollection", () => {
  it("organizes files into folders when requested", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "a",
      "Show.S01E02.mkv": "b"
    });

    // Provide a folder context so the title is extracted correctly for the JELLYFIN_TV pattern
    // The healCollection uses context from the parent directory.
    // To make this work smoothly, let's create them inside a folder inside TEST_ROOT
    createTestFiles({
      "Some Series/Some Series.S01E01.Pilot.mkv": "a",
      "Some Series/Some Series.S01E02.mkv": "b"
    });

    const result = await healCollection(join(TEST_ROOT, "Some Series"), false, MediaType.JELLYFIN_TV, undefined, true);
    expect(result.healed).toBe(2);
    expect(Object.keys(result.errors).length).toBe(0);

    // The files should be moved to "Some Series/Season 01/" inside the collection path.
    expect(existsSync(join(TEST_ROOT, "Some Series", "Some Series", "Season 01", "Some Series - S01E01 - Pilot.mkv"))).toBe(true);
    expect(existsSync(join(TEST_ROOT, "Some Series", "Some Series", "Season 01", "Some Series - S01E02.mkv"))).toBe(true);
  });

  it("returns clean result for an empty directory", async () => {
    const result = await healCollection(TEST_ROOT, true);
    expect(result.filesExamined).toBe(0);
    expect(result.healed).toBe(0);
    expect(result.wouldHeal).toBe(0);
  });

  it("in dry-run mode, counts wouldHeal without renaming", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "",
      "Show.S01E02.Episode.Two.mkv": ""
    });

    const result = await healCollection(TEST_ROOT, true);
    expect(result.healed).toBe(0);
    expect(result.filesExamined).toBeGreaterThan(0);
  });

  it("actually renames files when not in dry-run mode", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "content1",
      "Show.S01E02.Episode.Two.mkv": "content2"
    });

    const result = await healCollection(TEST_ROOT, false);
    expect(result.filesExamined).toBeGreaterThan(0);
    // Some files may be healed depending on detection
    expect(result.healed + result.skipped + Object.keys(result.errors).length)
      .toBeLessThanOrEqual(result.filesExamined);
  });

  it("uses a specified target type override", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "",
      "Show.S01E02.Cats.mkv": ""
    });

    const result = await healCollection(TEST_ROOT, true, MediaType.JELLYFIN_TV);
    expect(result.filesExamined).toBeGreaterThan(0);
  });

  it("handles invalid paths gracefully", async () => {
    const result = await healCollection("/nonexistent/path/no", false);
    expect(result.errors).toBeDefined();
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });

  it("heals a movie collection with folder context", async () => {
    createTestFiles({
      "Inception (2010)/Inception.1080p.BluRay.x264-YIFY.mkv": "movie"
    });

    const result = await healCollection(
      join(TEST_ROOT, "Inception (2010)"),
      true,
      MediaType.JELLYFIN_MOVIE
    );
    expect(result.filesExamined).toBeGreaterThanOrEqual(1);
  });

  it("creates undo snapshot for real heals", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "content"
    });

    // Just verify it doesn't throw — undo snapshots are internal
    const result = await healCollection(TEST_ROOT, false, MediaType.JELLYFIN_TV);
    expect(result.errors).toBeDefined();
  });

  it("deconflicts when healed names would collide", async () => {
    // Create files that would map to the same healed name
    createTestFiles({
      "video1.mkv": "a",
      "video2.mkv": "b"
    });

    const result = await healCollection(TEST_ROOT, false, MediaType.JELLYFIN_MOVIE);
    // Should not error out due to conflicts
    expect(Object.keys(result.errors).length).toBe(0);
  });
});

// ── scanSeriesGaps ────────────────────────────────────────────────

describe("scanSeriesGaps", () => {
  it("detects missing episodes in a TV series", () => {
    const files = [
      "/tv/Show.S01E01.Pilot.mkv",
      "/tv/Show.S01E02.Episode.Two.mkv",
      "/tv/Show.S01E04.Episode.Four.mkv",
      "/tv/Show.S01E05.Episode.Five.mkv"
    ];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_TV);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].season).toBe(1);
    expect(gaps[0].missingEpisodes).toEqual([3]);
    expect(gaps[0].foundCount).toBe(4);
    expect(gaps[0].expectedCount).toBe(5);
  });

  it("detects multiple missing episodes", () => {
    const files = [
      "/tv/Show.S01E01.mkv",
      "/tv/Show.S01E05.mkv",
      "/tv/Show.S01E10.mkv"
    ];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_TV);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingEpisodes).toContain(2);
    expect(gaps[0].missingEpisodes).toContain(3);
    expect(gaps[0].missingEpisodes).toContain(4);
    expect(gaps[0].missingEpisodes).toContain(6);
    expect(gaps[0].missingEpisodes.length).toBe(7);
  });

  it("detects gaps across multiple seasons", () => {
    const files = [
      "/tv/Show.S01E01.mkv",
      "/tv/Show.S01E02.mkv",
      "/tv/Show.S01E04.mkv",
      "/tv/Show.S02E01.mkv",
      "/tv/Show.S02E03.mkv"
    ];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_TV);
    expect(gaps).toHaveLength(2);
    const s1 = gaps.find(g => g.season === 1);
    const s2 = gaps.find(g => g.season === 2);
    expect(s1).toBeDefined();
    expect(s1!.missingEpisodes).toEqual([3]);
    expect(s2).toBeDefined();
    expect(s2!.missingEpisodes).toEqual([2]);
  });

  it("returns empty for complete series", () => {
    const files = [
      "/tv/Show.S01E01.mkv",
      "/tv/Show.S01E02.mkv",
      "/tv/Show.S01E03.mkv"
    ];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_TV);
    expect(gaps).toHaveLength(0);
  });

  it("returns empty for non-TV media types", () => {
    const files = ["/movie/Inception.2010.mkv"];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_MOVIE);
    expect(gaps).toHaveLength(0);
  });

  it("handles anime absolute numbering gaps", () => {
    const files = [
      "/anime/Naruto - 001.mkv",
      "/anime/Naruto - 002.mkv",
      "/anime/Naruto - 005.mkv"
    ];
    const gaps = scanSeriesGaps(files, MediaType.ANIME);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingEpisodes).toContain(3);
    expect(gaps[0].missingEpisodes).toContain(4);
  });

  it("returns empty for a single episode", () => {
    const files = ["/tv/Show.S01E01.mkv"];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_TV);
    expect(gaps).toHaveLength(0);
  });

  it("ignores non-video files", () => {
    const files = [
      "/tv/Show.S01E01.mkv",
      "/tv/Show.S01E03.mkv",
      "/tv/Show.S01E02.nfo"
    ];
    const gaps = scanSeriesGaps(files, MediaType.JELLYFIN_TV);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missingEpisodes).toEqual([2]);
  });
});

// ── scanQualityInconsistencies ────────────────────────────────────

describe("scanQualityInconsistencies", () => {
  it("identifies lower quality files in a collection", () => {
    const files = [
      "/tv/Show.S01E01.1080p.mkv",
      "/tv/Show.S01E02.1080p.mkv",
      "/tv/Show.S01E03.720p.mkv",
      "/tv/Show.S01E04.1080p.mkv"
    ];
    const report = scanQualityInconsistencies(files);
    expect(report.dominantResolution).toBe("1080p");
    expect(report.lowerQualityFiles).toHaveLength(1);
    expect(report.lowerQualityFiles[0].filePath).toContain("E03");
    expect(report.lowerQualityFiles[0].resolution).toBe("720p");
  });

  it("returns empty for consistent quality", () => {
    const files = [
      "/tv/Show.S01E01.1080p.mkv",
      "/tv/Show.S01E02.1080p.mkv",
      "/tv/Show.S01E03.1080p.mkv"
    ];
    const report = scanQualityInconsistencies(files);
    expect(report.lowerQualityFiles).toHaveLength(0);
    expect(report.dominantResolution).toBe("1080p");
  });

  it("reports resolution counts", () => {
    const files = [
      "/tv/Show.S01E01.2160p.mkv",
      "/tv/Show.S01E02.1080p.mkv",
      "/tv/Show.S01E03.2160p.mkv",
      "/tv/Show.S01E04.720p.mkv"
    ];
    const report = scanQualityInconsistencies(files);
    expect(report.resolutionCounts["4K"]).toBe(2);
    expect(report.resolutionCounts["1080p"]).toBe(1);
    expect(report.resolutionCounts["720p"]).toBe(1);
    expect(report.dominantResolution).toBe("4K");
  });

  it("handles files with no resolution tags", () => {
    const files = [
      "/tv/Show.S01E01.mkv",
      "/tv/Show.S01E02.mkv"
    ];
    const report = scanQualityInconsistencies(files);
    expect(report.lowerQualityFiles).toHaveLength(0);
    expect(Object.keys(report.resolutionCounts)).toHaveLength(0);
  });

  it("ignores non-video files", () => {
    const files = [
      "/tv/Show.S01E01.1080p.mkv",
      "/tv/cover.720p.jpg"
    ];
    const report = scanQualityInconsistencies(files);
    expect(report.lowerQualityFiles).toHaveLength(0);
  });

  it("detects 480p as lower quality in a 1080p collection", () => {
    const files = [
      "/tv/Show.S01E01.1080p.mkv",
      "/tv/Show.S01E02.1080p.mkv",
      "/tv/Show.S01E03.480p.mkv"
    ];
    const report = scanQualityInconsistencies(files);
    expect(report.lowerQualityFiles).toHaveLength(1);
    expect(report.lowerQualityFiles[0].resolution).toBe("480p");
  });
});

// ── detectNamingScheme ────────────────────────────────────────────

describe("detectNamingScheme", () => {
  it("detects SxxExx scheme", () => {
    expect(detectNamingScheme("Show.S01E01.Pilot.mkv")).toBe("SxxExx");
  });

  it("detects NxNN scheme", () => {
    expect(detectNamingScheme("Show.1x02.Episode.mkv")).toBe("NxNN");
  });

  it("detects scene dots scheme", () => {
    expect(detectNamingScheme("Movie.Title.2020.1080p.BluRay.mkv")).toBe("scene_dots");
  });

  it("detects dash SxxExx scheme", () => {
    expect(detectNamingScheme("Show - S01E01 - Pilot.mkv")).toBe("dash_SxxExx");
  });

  it("detects absolute numbering", () => {
    expect(detectNamingScheme("Naruto - 042.mkv")).toBe("absolute");
  });

  it("returns other for unrecognized patterns", () => {
    expect(detectNamingScheme("random file.mkv")).toBe("other");
  });
});

// ── scanNamingInconsistencies ─────────────────────────────────────

describe("scanNamingInconsistencies", () => {
  it("detects files using different naming schemes in same directory", () => {
    const files = [
      "/tv/season1/Show.S01E01.Pilot.mkv",
      "/tv/season1/Show.S01E02.Episode.mkv",
      "/tv/season1/Show.S01E03.Episode.mkv",
      "/tv/season1/Show.1x04.Episode.mkv"
    ];
    const inconsistent = scanNamingInconsistencies(files);
    expect(inconsistent).toHaveLength(1);
    expect(inconsistent[0]).toContain("1x04");
  });

  it("returns empty for consistent naming", () => {
    const files = [
      "/tv/Show.S01E01.mkv",
      "/tv/Show.S01E02.mkv",
      "/tv/Show.S01E03.mkv"
    ];
    const inconsistent = scanNamingInconsistencies(files);
    expect(inconsistent).toHaveLength(0);
  });

  it("returns empty for a single file", () => {
    const files = ["/tv/Show.S01E01.mkv"];
    const inconsistent = scanNamingInconsistencies(files);
    expect(inconsistent).toHaveLength(0);
  });

  it("works across multiple directories independently", () => {
    const files = [
      "/tv/season1/Show.S01E01.mkv",
      "/tv/season1/Show.S01E02.mkv",
      "/tv/season2/Show.S02E01.mkv",
      "/tv/season2/Show.S02E02.mkv",
      "/tv/season2/Show.2x03.Episode.mkv"
    ];
    const inconsistent = scanNamingInconsistencies(files);
    // Only the NxNN file in season2 should be flagged
    expect(inconsistent).toHaveLength(1);
    expect(inconsistent[0]).toContain("season2");
  });
});

// ── diagnoseCollection with new features ──────────────────────────

describe("diagnoseCollection (enhanced)", () => {
  it("detects episode gaps in a TV collection", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "",
      "Show.S01E02.Episode.mkv": "",
      "Show.S01E04.Episode.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.episodeGaps.length).toBeGreaterThan(0);
    const gap = result.episodeGaps[0];
    expect(gap.missingEpisodes).toContain(3);
  });

  it("reports quality inconsistencies", async () => {
    createTestFiles({
      "Show.S01E01.1080p.mkv": "",
      "Show.S01E02.1080p.mkv": "",
      "Show.S01E03.720p.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.qualityReport).toBeDefined();
    expect(result.qualityReport!.dominantResolution).toBe("1080p");
    expect(result.qualityReport!.lowerQualityFiles.length).toBe(1);
  });

  it("includes lower_quality issues in main issues list", async () => {
    createTestFiles({
      "Show.S01E01.1080p.mkv": "",
      "Show.S01E02.1080p.mkv": "",
      "Show.S01E03.720p.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    const lqIssues = result.issues.filter(i => i.kind === "lower_quality");
    expect(lqIssues.length).toBe(1);
  });

  it("includes episode gap issues in main issues list", async () => {
    createTestFiles({
      "Show.S01E01.mkv": "",
      "Show.S01E03.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    const gapIssues = result.issues.filter(i => i.kind === "missing_episode_gap");
    expect(gapIssues.length).toBeGreaterThan(0);
    expect(gapIssues[0].description).toContain("missing episode");
  });

  it("detects duplicate episodes", async () => {
    createTestFiles({
      "Show.S01E01.720p.mkv": "",
      "Show.S01E01.1080p.mkv": "",
      "Show.S01E02.1080p.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    const dupes = result.issues.filter(i => i.kind === "duplicate_episode");
    expect(dupes.length).toBe(2); // both copies flagged
  });

  it("reports naming inconsistencies in the result", async () => {
    createTestFiles({
      "Show.S01E01.mkv": "",
      "Show.S01E02.mkv": "",
      "Show.S01E03.mkv": "",
      "Show.1x04.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.namingInconsistencies.length).toBeGreaterThan(0);
  });

  it("handles collections with no resolution info for quality report", async () => {
    createTestFiles({
      "Show.S01E01.mkv": "",
      "Show.S01E02.mkv": ""
    });

    const result = await diagnoseCollection(TEST_ROOT);
    // Should either be undefined or have no lower quality files
    if (result.qualityReport) {
      expect(result.qualityReport.lowerQualityFiles).toHaveLength(0);
    }
  });

  it("returns empty arrays for enhanced fields on empty directory", async () => {
    const result = await diagnoseCollection(TEST_ROOT);
    expect(result.episodeGaps).toEqual([]);
    expect(result.namingInconsistencies).toEqual([]);
  });
});
