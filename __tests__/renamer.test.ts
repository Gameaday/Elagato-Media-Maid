/**
 * Tests for src/lib/renamer.ts
 * Uses the real filesystem via tmp directories.
 */

import { writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

import { parseTvPattern, parseYearFromFilename, renameFolder } from "../src/lib/renamer";
import { jellyfinTvPattern, jellyfinMoviePattern } from "../src/lib/patterns";

// ---------------------------------------------------------------------------
// parseTvPattern
// ---------------------------------------------------------------------------
describe("parseTvPattern", () => {
  it("parses standard SxxExx", () => {
    const meta = parseTvPattern("Breaking Bad - S01E04 - Cancer Man");
    expect(meta.title).toBe("Breaking Bad");
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(4);
    expect(meta.episodeTitle).toBe("Cancer Man");
  });

  it("parses dot-separated SxxExx", () => {
    const meta = parseTvPattern("Game.of.Thrones.S03E09.The.Rains.of.Castamere");
    expect(meta.title).toBe("Game of Thrones");
    expect(meta.season).toBe(3);
    expect(meta.episode).toBe(9);
  });

  it("parses NxNN format", () => {
    const meta = parseTvPattern("Seinfeld 4x12 The Junior Mint");
    expect(meta.title).toBe("Seinfeld");
    expect(meta.season).toBe(4);
    expect(meta.episode).toBe(12);
  });

  it("returns empty object for non-TV filename", () => {
    const meta = parseTvPattern("some random file");
    expect(meta.title).toBeUndefined();
    expect(meta.season).toBeUndefined();
    expect(meta.episode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseYearFromFilename
// ---------------------------------------------------------------------------
describe("parseYearFromFilename", () => {
  it("extracts year from parentheses", () => {
    expect(parseYearFromFilename("Inception (2010)")).toBe(2010);
  });

  it("extracts year from dot-separated", () => {
    expect(parseYearFromFilename("The.Matrix.1999.mkv")).toBe(1999);
  });

  it("returns undefined when no year present", () => {
    expect(parseYearFromFilename("some title")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renameFolder integration tests
// ---------------------------------------------------------------------------
function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mediamaid-test-"));
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe("renameFolder – Jellyfin TV (dry run)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    // Create sample episode files
    writeFileSync(join(tmpDir, "Breaking.Bad.S01E01.Pilot.mkv"), "");
    writeFileSync(join(tmpDir, "Breaking.Bad.S01E02.Cat.in.the.Bag.mkv"), "");
    writeFileSync(join(tmpDir, "readme.txt"), ""); // should be ignored
  });

  afterEach(() => cleanupDir(tmpDir));

  it("dry-run returns correct operations without renaming files", async () => {
    const result = await renameFolder(tmpDir, jellyfinTvPattern, true);
    // txt file is not in the TV pattern extensions, so only 2 mkv files
    expect(result.operations.length).toBe(2);
    expect(result.renamed).toBe(0); // dry run – nothing actually renamed
    // Original files must still exist
    expect(existsSync(join(tmpDir, "Breaking.Bad.S01E01.Pilot.mkv"))).toBe(true);
    expect(existsSync(join(tmpDir, "Breaking.Bad.S01E02.Cat.in.the.Bag.mkv"))).toBe(true);
  });

  it("dry-run operations reference the correct new names", async () => {
    const result = await renameFolder(tmpDir, jellyfinTvPattern, true);
    const names = result.operations.map(op => op.to.split("/").pop() ?? op.to.split("\\").pop());
    // Both should match the Jellyfin TV format
    expect(names.some(n => n?.startsWith("Breaking Bad - S01E01"))).toBe(true);
    expect(names.some(n => n?.startsWith("Breaking Bad - S01E02"))).toBe(true);
  });
});

describe("renameFolder – Jellyfin TV (live)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    writeFileSync(join(tmpDir, "Breaking.Bad.S02E03.No.Mas.mkv"), "");
    writeFileSync(join(tmpDir, "cover.jpg"), ""); // should be skipped
  });

  afterEach(() => cleanupDir(tmpDir));

  it("renames matching files", async () => {
    const result = await renameFolder(tmpDir, jellyfinTvPattern, false);
    expect(result.renamed).toBe(1);
    expect(result.skipped).toBe(0);
    const files = readdirSync(tmpDir);
    expect(files.some(f => f.startsWith("Breaking Bad - S02E03"))).toBe(true);
    // Original should no longer exist
    expect(existsSync(join(tmpDir, "Breaking.Bad.S02E03.No.Mas.mkv"))).toBe(false);
  });
});

describe("renameFolder – deconfliction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    // Two files that would produce the same target name
    writeFileSync(join(tmpDir, "Show.S01E01.A.mkv"), "");
    writeFileSync(join(tmpDir, "Show.S01E01.B.mkv"), "");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("produces unique filenames when collision occurs", async () => {
    const result = await renameFolder(tmpDir, jellyfinTvPattern, true);
    const targets = result.operations.map(op => op.to);
    const unique = new Set(targets);
    expect(unique.size).toBe(targets.length);
  });
});

describe("renameFolder – Jellyfin Movie (live)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    writeFileSync(join(tmpDir, "Inception.2010.1080p.mkv"), "");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("renames with year in output", async () => {
    const result = await renameFolder(tmpDir, jellyfinMoviePattern, false);
    expect(result.renamed).toBe(1);
    const files = readdirSync(tmpDir);
    expect(files.some(f => f.includes("(2010)"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseTvPattern – extended edge cases
// ---------------------------------------------------------------------------
describe("parseTvPattern – edge cases", () => {
  it("strips release group tags from episode title", () => {
    const meta = parseTvPattern("Show.S01E03.Episode Title.720p.BluRay.x264");
    expect(meta.episodeTitle).toBe("Episode Title");
  });

  it("handles multi-episode SxxExxExx", () => {
    const meta = parseTvPattern("Show.S02E05E06.Part One");
    expect(meta.season).toBe(2);
    expect(meta.episode).toBe(5);
    expect(meta.episodeTitle).toBe("Part One");
  });

  it("handles three-digit episode numbers", () => {
    const meta = parseTvPattern("Anime.S01E100.Big Episode");
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(100);
  });

  it("handles NxNNN three-digit episode", () => {
    const meta = parseTvPattern("Anime 1x100 Big Episode");
    expect(meta.season).toBe(1);
    expect(meta.episode).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// parseMusicPattern
// ---------------------------------------------------------------------------
import { parseMusicPattern } from "../src/lib/renamer";

describe("parseMusicPattern", () => {
  it("parses track# - artist - song", () => {
    const meta = parseMusicPattern("01 - Pink Floyd - Comfortably Numb");
    expect(meta.trackNumber).toBe(1);
    expect(meta.artist).toBe("Pink Floyd");
    expect(meta.songTitle).toBe("Comfortably Numb");
  });

  it("parses dot-separated track# format", () => {
    const meta = parseMusicPattern("03. Artist Name - Song Title");
    expect(meta.trackNumber).toBe(3);
    expect(meta.artist).toBe("Artist Name");
    expect(meta.songTitle).toBe("Song Title");
  });

  it("parses artist - song without track number", () => {
    const meta = parseMusicPattern("Led Zeppelin - Stairway to Heaven");
    expect(meta.artist).toBe("Led Zeppelin");
    expect(meta.songTitle).toBe("Stairway to Heaven");
    expect(meta.trackNumber).toBeUndefined();
  });

  it("returns empty for unparseable filename", () => {
    const meta = parseMusicPattern("random noise here");
    expect(meta.artist).toBeUndefined();
    expect(meta.songTitle).toBeUndefined();
    expect(meta.trackNumber).toBeUndefined();
  });

  it("parses track# followed by song title (no artist)", () => {
    const meta = parseMusicPattern("01 Song Title");
    expect(meta.trackNumber).toBe(1);
    expect(meta.songTitle).toBe("Song Title");
    expect(meta.artist).toBeUndefined();
  });

  it("parses track# with dot separator and song title (no artist)", () => {
    const meta = parseMusicPattern("05.My_Song_Title");
    expect(meta.trackNumber).toBe(5);
    expect(meta.songTitle).toBe("My Song Title");
  });
});

// ---------------------------------------------------------------------------
// renameFolder – path validation
// ---------------------------------------------------------------------------
describe("renameFolder – path validation", () => {
  it("returns error for empty path", async () => {
    const result = await renameFolder("", jellyfinTvPattern, true);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });

  it("returns error for non-existent path", async () => {
    const result = await renameFolder("/nonexistent/path/xyz", jellyfinTvPattern, true);
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  });
});
