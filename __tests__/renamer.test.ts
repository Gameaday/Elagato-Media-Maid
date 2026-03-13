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
