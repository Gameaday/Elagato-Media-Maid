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

  it("returns UNKNOWN for an empty folder", async () => {
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.UNKNOWN);
    expect(result.confidence).toBe(0);
  });

  it("detects TV show folder with SxxExx pattern files", async () => {
    touch(tmpDir, "Breaking.Bad.S01E01.Pilot.mkv");
    touch(tmpDir, "Breaking.Bad.S01E02.mkv");
    touch(tmpDir, "Breaking.Bad.S01E03.mkv");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_TV);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects photo folder", async () => {
    touch(tmpDir, "IMG_0001.jpg");
    touch(tmpDir, "IMG_0002.jpg");
    touch(tmpDir, "IMG_0003.heic");
    touch(tmpDir, "IMG_0004.png");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.PHOTOGRAPHY);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects music folder", async () => {
    touch(tmpDir, "01 - Artist - Song.flac");
    touch(tmpDir, "02 - Artist - Song2.flac");
    touch(tmpDir, "03 - Artist - Song3.mp3");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.MUSIC);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects ebook folder", async () => {
    touch(tmpDir, "book1.epub");
    touch(tmpDir, "book2.epub");
    touch(tmpDir, "book3.mobi");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.BOOKS);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects document folder", async () => {
    touch(tmpDir, "report.pdf");
    touch(tmpDir, "notes.docx");
    touch(tmpDir, "spreadsheet.xlsx");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.GENERIC_DOCS);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("leans toward movie when small number of videos without TV patterns", async () => {
    touch(tmpDir, "Inception.2010.1080p.mkv");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_MOVIE);
  });

  it("detects TV when NFO file is present with video files", async () => {
    touch(tmpDir, "Show.S01E01.mkv");
    touch(tmpDir, "Show.S01E02.mkv");
    touch(tmpDir, "tvshow.nfo");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_TV);
  });

  it("includes extension counts in the result", async () => {
    touch(tmpDir, "file.mp3");
    touch(tmpDir, "file2.mp3");
    touch(tmpDir, "file3.flac");
    const result = await detectMediaType(tmpDir);
    expect(result.extensionCounts[".mp3"]).toBe(2);
    expect(result.extensionCounts[".flac"]).toBe(1);
  });

  it("detects ROM folder with emulation ROM files", async () => {
    touch(tmpDir, "Super Mario Bros (USA).nes");
    touch(tmpDir, "Zelda (USA).nes");
    touch(tmpDir, "Metroid (Japan).nes");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.EMULATION_ROMS);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects mixed ROM folder with multiple platforms", async () => {
    touch(tmpDir, "Mario.nes");
    touch(tmpDir, "Zelda.sfc");
    touch(tmpDir, "Pokemon.gba");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.EMULATION_ROMS);
  });

  it("detects movie multi-version when multiple resolution-tagged videos exist", async () => {
    touch(tmpDir, "Inception.2010.1080p.BluRay.mkv");
    touch(tmpDir, "Inception.2010.2160p.WEB-DL.mkv");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_MOVIE_VERSION);
  });

  it("detects single movie (not multi-version) when only one resolution tag", async () => {
    touch(tmpDir, "Inception.2010.1080p.mkv");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.JELLYFIN_MOVIE);
  });

  it("detects podcast folder with date-named audio files", async () => {
    touch(tmpDir, "My Show - 2024-01-15 - Episode One.mp3");
    touch(tmpDir, "My Show - 2024-01-22 - Episode Two.mp3");
    touch(tmpDir, "My Show - 2024-02-01 - Episode Three.mp3");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.PODCAST_ARCHIVE);
  });

  it("detects comic folder with vol/chapter markers", async () => {
    touch(tmpDir, "One Piece Vol 01 Ch 001.cbz");
    touch(tmpDir, "One Piece Vol 01 Ch 002.cbz");
    touch(tmpDir, "One Piece Vol 01 Ch 003.cbz");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.COMICS);
  });

  it("detects anime with fansub tags only (no absolute numbering)", async () => {
    touch(tmpDir, "[SubGroup] Naruto - S01E01.mkv");
    touch(tmpDir, "[SubGroup] Naruto - S01E02.mkv");
    touch(tmpDir, "[SubGroup] Naruto - S01E03.mkv");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.ANIME);
  });

  it("detects YouTube archive with a single video ID file", async () => {
    touch(tmpDir, "How to Code [dQw4w9WgXcQ].mp4");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.YOUTUBE_ARCHIVE);
  });

  it("prefers podcast over music when audio files have dates", async () => {
    touch(tmpDir, "2024-03-10 - Interview with Guest.mp3");
    touch(tmpDir, "2024-03-17 - Special Episode.mp3");
    touch(tmpDir, "2024-03-24 - Roundtable.mp3");
    touch(tmpDir, "bonus track.mp3");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.PODCAST_ARCHIVE);
  });

  it("detects comic files (cbr) without vol/chapter markers", async () => {
    touch(tmpDir, "Batman Issue 1.cbr");
    touch(tmpDir, "Batman Issue 2.cbr");
    touch(tmpDir, "Batman Issue 3.cbr");
    const result = await detectMediaType(tmpDir);
    expect(result.mediaType).toBe(MediaType.COMICS);
  });
});
