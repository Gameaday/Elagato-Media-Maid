/**
 * Tests for src/lib/detector.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

import { detectMediaType } from "../src/lib/detector";
import { MediaType } from "../src/lib/patterns";

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mediamaid-detect-"));
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function touch(dir: string, filename: string): void {
  writeFileSync(join(dir, filename), "");
}

describe("detectMediaType", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => cleanupDir(tmpDir));

  it("returns UNKNOWN for an empty folder", () => {
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.UNKNOWN);
    expect(result.confidence).toBe(0);
  });

  it("detects TV show folder with SxxExx pattern files", () => {
    touch(tmpDir, "Breaking.Bad.S01E01.Pilot.mkv");
    touch(tmpDir, "Breaking.Bad.S01E02.mkv");
    touch(tmpDir, "Breaking.Bad.S01E03.mkv");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_TV);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects photo folder", () => {
    touch(tmpDir, "IMG_0001.jpg");
    touch(tmpDir, "IMG_0002.jpg");
    touch(tmpDir, "IMG_0003.heic");
    touch(tmpDir, "IMG_0004.png");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.PHOTOGRAPHY);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects music folder", () => {
    touch(tmpDir, "01 - Artist - Song.flac");
    touch(tmpDir, "02 - Artist - Song2.flac");
    touch(tmpDir, "03 - Artist - Song3.mp3");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.MUSIC);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects ebook folder", () => {
    touch(tmpDir, "book1.epub");
    touch(tmpDir, "book2.epub");
    touch(tmpDir, "book3.mobi");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.BOOKS);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects document folder", () => {
    touch(tmpDir, "report.pdf");
    touch(tmpDir, "notes.docx");
    touch(tmpDir, "spreadsheet.xlsx");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.GENERIC_DOCS);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("leans toward movie when small number of videos without TV patterns", () => {
    touch(tmpDir, "Inception.2010.1080p.mkv");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_MOVIE);
  });

  it("detects TV when NFO file is present with video files", () => {
    touch(tmpDir, "Show.S01E01.mkv");
    touch(tmpDir, "Show.S01E02.mkv");
    touch(tmpDir, "tvshow.nfo");
    const result = detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_TV);
  });

  it("includes extension counts in the result", () => {
    touch(tmpDir, "file.mp3");
    touch(tmpDir, "file2.mp3");
    touch(tmpDir, "file3.flac");
    const result = detectMediaType(tmpDir);
    expect(result.extensionCounts[".mp3"]).toBe(2);
    expect(result.extensionCounts[".flac"]).toBe(1);
  });
});
