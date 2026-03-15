/**
 * Tests for src/lib/organizer.ts
 */

import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

import { sortFolder, DEFAULT_SORT_RULES } from "../src/lib/organizer";

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mediamaid-organizer-"));
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function touch(dir: string, filename: string): void {
  writeFileSync(join(dir, filename), "");
}

describe("sortFolder – dry run", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    touch(tmpDir, "photo.jpg");
    touch(tmpDir, "movie.mkv");
    touch(tmpDir, "song.mp3");
    touch(tmpDir, "document.pdf");
    touch(tmpDir, "installer.exe");
    touch(tmpDir, "archive.zip");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("returns the correct categories in dry run without moving files", async () => {
    const result = await sortFolder(tmpDir, DEFAULT_SORT_RULES, true, true);
    expect(result.totalMoved).toBe(6);
    expect(result.moved["Images"]).toContain("photo.jpg");
    expect(result.moved["Videos"]).toContain("movie.mkv");
    expect(result.moved["Audio"]).toContain("song.mp3");
    expect(result.moved["Documents"]).toContain("document.pdf");
    expect(result.moved["Installers"]).toContain("installer.exe");
    expect(result.moved["Archives"]).toContain("archive.zip");
    // No actual subfolders should be created
    expect(existsSync(join(tmpDir, "Images"))).toBe(false);
    expect(existsSync(join(tmpDir, "Videos"))).toBe(false);
  });
});

describe("sortFolder – live", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    touch(tmpDir, "photo.jpg");
    touch(tmpDir, "note.txt");
    touch(tmpDir, "unknown.xyz");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("creates subfolders and moves files", async () => {
    const result = await sortFolder(tmpDir, DEFAULT_SORT_RULES, false, true);
    expect(result.errors).toEqual({});
    // photo.jpg → Images/
    expect(existsSync(join(tmpDir, "Images", "photo.jpg"))).toBe(true);
    // note.txt → Documents/
    expect(existsSync(join(tmpDir, "Documents", "note.txt"))).toBe(true);
    // unknown.xyz → Other/
    expect(existsSync(join(tmpDir, "Other", "unknown.xyz"))).toBe(true);
  });

  it("skips creating Other folder when createOther is false", async () => {
    const result = await sortFolder(tmpDir, DEFAULT_SORT_RULES, false, false);
    expect(existsSync(join(tmpDir, "Other"))).toBe(false);
    expect(result.unmoved).toContain("unknown.xyz");
  });

  it("moves images correctly", async () => {
    const result = await sortFolder(tmpDir, DEFAULT_SORT_RULES, false, false);
    expect(existsSync(join(tmpDir, "Images", "photo.jpg"))).toBe(true);
    expect(result.totalMoved).toBeGreaterThanOrEqual(1);
  });
});

describe("sortFolder – multiple file types", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    ["a.epub", "b.mobi", "c.azw"].forEach(f => touch(tmpDir, f));
    ["d.py", "e.go"].forEach(f => touch(tmpDir, f));
  });

  afterEach(() => cleanupDir(tmpDir));

  it("sorts ebooks and code separately", async () => {
    await sortFolder(tmpDir, DEFAULT_SORT_RULES, false, false);
    expect(existsSync(join(tmpDir, "eBooks", "a.epub"))).toBe(true);
    expect(existsSync(join(tmpDir, "eBooks", "b.mobi"))).toBe(true);
    expect(existsSync(join(tmpDir, "Code", "d.py"))).toBe(true);
    expect(existsSync(join(tmpDir, "Code", "e.go"))).toBe(true);
  });
});

describe("sortFolder – ROM files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    ["mario.nes", "zelda.sfc", "pokemon.gba"].forEach(f => touch(tmpDir, f));
  });

  afterEach(() => cleanupDir(tmpDir));

  it("sorts ROM files into ROMs/ folder", async () => {
    await sortFolder(tmpDir, DEFAULT_SORT_RULES, false, false);
    expect(existsSync(join(tmpDir, "ROMs", "mario.nes"))).toBe(true);
    expect(existsSync(join(tmpDir, "ROMs", "zelda.sfc"))).toBe(true);
    expect(existsSync(join(tmpDir, "ROMs", "pokemon.gba"))).toBe(true);
  });

  it("reports ROM files in dry run", async () => {
    const result = await sortFolder(tmpDir, DEFAULT_SORT_RULES, true, false);
    expect(result.moved["ROMs"]).toContain("mario.nes");
    expect(result.moved["ROMs"]).toContain("zelda.sfc");
    expect(result.moved["ROMs"]).toContain("pokemon.gba");
    expect(result.totalMoved).toBe(3);
  });
});
