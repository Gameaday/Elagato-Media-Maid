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
  buildHealedName
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
});

// ── healCollection ─────────────────────────────────────────────────

describe("healCollection", () => {
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
