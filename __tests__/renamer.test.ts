/**
 * Tests for src/lib/renamer.ts
 * Uses the real filesystem via tmp directories.
 */

import { writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

import { parseTvPattern, parseYearFromFilename, parseRomPattern, parseResolutionFromFilename, parseMovieTitle, parseSourceFromFilename, parseHdrFromFilename, buildVersionTag, parseYoutubePattern, parseAnimePattern, parsePodcastPattern, parseComicPattern, renameFolder } from "../src/lib/renamer";
import { jellyfinTvPattern, jellyfinMoviePattern, jellyfinMovieVersionPattern, emulationRomsPattern } from "../src/lib/patterns";

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
// parseResolutionFromFilename
// ---------------------------------------------------------------------------
describe("parseResolutionFromFilename", () => {
  it("extracts 1080p", () => {
    expect(parseResolutionFromFilename("Inception.2010.1080p.BluRay.mkv")).toBe("1080p");
  });

  it("extracts 720p", () => {
    expect(parseResolutionFromFilename("Movie.720p.mkv")).toBe("720p");
  });

  it("normalises 2160p to 4K", () => {
    expect(parseResolutionFromFilename("Movie.2160p.mkv")).toBe("4K");
  });

  it("normalises 4K label", () => {
    expect(parseResolutionFromFilename("Movie.4K.mkv")).toBe("4K");
  });

  it("extracts 480p", () => {
    expect(parseResolutionFromFilename("Movie.480p.avi")).toBe("480p");
  });

  it("returns undefined when no resolution present", () => {
    expect(parseResolutionFromFilename("Inception")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseMovieTitle
// ---------------------------------------------------------------------------
describe("parseMovieTitle", () => {
  it("extracts title before year and release tags", () => {
    expect(parseMovieTitle("Inception.2010.1080p.BluRay.x264")).toBe("Inception");
  });

  it("extracts multi-word title", () => {
    expect(parseMovieTitle("The.Dark.Knight.2008.720p")).toBe("The Dark Knight");
  });

  it("returns baseName when no year/tags present", () => {
    expect(parseMovieTitle("Inception")).toBe("Inception");
  });

  it("handles underscores", () => {
    expect(parseMovieTitle("The_Matrix_1999_1080p")).toBe("The Matrix");
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

describe("renameFolder – Jellyfin Movie Multi-Version (dry run)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    writeFileSync(join(tmpDir, "Inception.2010.1080p.BluRay.mkv"), "");
    writeFileSync(join(tmpDir, "Inception.2010.2160p.WEB-DL.mkv"), "");
  });

  afterEach(() => cleanupDir(tmpDir));

  it("includes resolution tag in output", async () => {
    const result = await renameFolder(tmpDir, jellyfinMovieVersionPattern, true);
    expect(result.operations.length).toBe(2);
    const names = result.operations.map(op => op.to.split("/").pop() ?? op.to.split("\\").pop());
    expect(names.some(n => n?.includes("[1080p Bluray]"))).toBe(true);
    expect(names.some(n => n?.includes("[4K WEBDL]"))).toBe(true);
  });

  it("both files get year in output", async () => {
    const result = await renameFolder(tmpDir, jellyfinMovieVersionPattern, true);
    for (const op of result.operations) {
      const name = op.to.split("/").pop() ?? op.to.split("\\").pop() ?? "";
      expect(name).toContain("(2010)");
    }
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

// ---------------------------------------------------------------------------
// parseRomPattern
// ---------------------------------------------------------------------------
describe("parseRomPattern", () => {
  it("extracts region from parenthesised tag", () => {
    const meta = parseRomPattern("Super Mario Bros (USA) [!]", ".nes");
    expect(meta.region).toBe("USA");
  });

  it("extracts title by stripping scene and region tags", () => {
    const meta = parseRomPattern("Super Mario Bros (USA) [!]", ".nes");
    expect(meta.title).toBe("Super Mario Bros");
  });

  it("handles multi-region tags", () => {
    const meta = parseRomPattern("Sonic the Hedgehog (Japan, USA)", ".gen");
    expect(meta.region).toBe("Japan, USA");
    expect(meta.title).toBe("Sonic the Hedgehog");
  });

  it("handles filenames with no tags", () => {
    const meta = parseRomPattern("Zelda", ".sfc");
    expect(meta.title).toBe("Zelda");
    expect(meta.region).toBeUndefined();
  });

  it("maps extension to platform", () => {
    const meta = parseRomPattern("Game", ".nes");
    expect(meta.platform).toBe("NES");
  });

  it("maps .gba to Game Boy Advance", () => {
    const meta = parseRomPattern("Game", ".gba");
    expect(meta.platform).toBe("Game Boy Advance");
  });

  it("strips multiple scene tags", () => {
    const meta = parseRomPattern("Game (Europe) [!] [h1]", ".sfc");
    expect(meta.title).toBe("Game");
    expect(meta.region).toBe("Europe");
  });

  it("returns undefined platform for unknown extension", () => {
    const meta = parseRomPattern("Game", ".xyz");
    expect(meta.platform).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renameFolder – emulation ROMs
// ---------------------------------------------------------------------------
describe("renameFolder – ROMs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mediamaid-rom-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renames ROM files and strips scene tags in dry run", async () => {
    writeFileSync(join(tmpDir, "Super Mario Bros (USA) [!].nes"), "");
    const result = await renameFolder(tmpDir, emulationRomsPattern, true);
    expect(result.operations.length).toBe(1);
    expect(result.operations[0].to).toContain("Super Mario Bros (USA).nes");
  });

  it("preserves region tag in renamed file", async () => {
    writeFileSync(join(tmpDir, "Zelda (Japan) [b].sfc"), "");
    const result = await renameFolder(tmpDir, emulationRomsPattern, true);
    expect(result.operations[0].to).toContain("Zelda (Japan).sfc");
  });
});

// ---------------------------------------------------------------------------
// parseSourceFromFilename
// ---------------------------------------------------------------------------
describe("parseSourceFromFilename", () => {
  it("extracts BluRay", () => {
    expect(parseSourceFromFilename("Movie.2021.1080p.BluRay.x264")).toBe("Bluray");
  });

  it("extracts Blu-Ray variant", () => {
    expect(parseSourceFromFilename("Movie.Blu-Ray.mkv")).toBe("Bluray");
  });

  it("extracts WEB-DL", () => {
    expect(parseSourceFromFilename("Movie.2021.1080p.WEB-DL")).toBe("WEBDL");
  });

  it("extracts WEBDL without hyphen", () => {
    expect(parseSourceFromFilename("Movie.WEBDL.1080p")).toBe("WEBDL");
  });

  it("extracts REMUX", () => {
    expect(parseSourceFromFilename("Movie.2160p.REMUX.mkv")).toBe("Remux");
  });

  it("extracts HDTV", () => {
    expect(parseSourceFromFilename("Show.S01E01.HDTV.mkv")).toBe("HDTV");
  });

  it("extracts WEBRip", () => {
    expect(parseSourceFromFilename("Movie.WEBRip.1080p")).toBe("WEBRip");
  });

  it("extracts DVDRip", () => {
    expect(parseSourceFromFilename("Movie.DVDRip.XviD")).toBe("DVDRip");
  });

  it("returns undefined when no source tag present", () => {
    expect(parseSourceFromFilename("Movie.2021.mkv")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseHdrFromFilename
// ---------------------------------------------------------------------------
describe("parseHdrFromFilename", () => {
  it("extracts HDR", () => {
    expect(parseHdrFromFilename("Movie.2160p.HDR.mkv")).toBe("HDR");
  });

  it("extracts HDR10", () => {
    expect(parseHdrFromFilename("Movie.HDR10.BluRay")).toBe("HDR10");
  });

  it("extracts HDR10+", () => {
    expect(parseHdrFromFilename("Movie.HDR10+.mkv")).toBe("HDR10+");
  });

  it("extracts DV (Dolby Vision shorthand)", () => {
    expect(parseHdrFromFilename("Movie.DV.2160p")).toBe("DV");
  });

  it("extracts DoVi", () => {
    expect(parseHdrFromFilename("Movie.DoVi.mkv")).toBe("DV");
  });

  it("returns undefined when no HDR tag present", () => {
    expect(parseHdrFromFilename("Movie.1080p.BluRay")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildVersionTag
// ---------------------------------------------------------------------------
describe("buildVersionTag", () => {
  it("combines resolution and source", () => {
    expect(buildVersionTag("Movie.1080p.BluRay.x264")).toBe("1080p Bluray");
  });

  it("combines resolution, source, and HDR", () => {
    expect(buildVersionTag("Movie.2160p.BluRay.REMUX.HDR")).toBe("4K Bluray HDR");
  });

  it("returns resolution only when no source/HDR", () => {
    expect(buildVersionTag("Movie.720p.mkv")).toBe("720p");
  });

  it("returns source only when no resolution", () => {
    expect(buildVersionTag("Movie.BluRay.mkv")).toBe("Bluray");
  });

  it("returns HDR with resolution", () => {
    expect(buildVersionTag("Movie.2160p.HDR10.mkv")).toBe("4K HDR10");
  });

  it("returns undefined for files with no quality tags", () => {
    expect(buildVersionTag("regular_document.txt")).toBeUndefined();
  });

  it("handles DV + resolution combo", () => {
    expect(buildVersionTag("Movie.2160p.DV.mkv")).toBe("4K DV");
  });
});

// ---------------------------------------------------------------------------
// Jellyfin Movie Multi-Version with enhanced version tags
// ---------------------------------------------------------------------------
describe("renameFolder – enhanced multi-version tags", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => cleanupDir(tmpDir));

  it("includes source tag in multi-version output", async () => {
    writeFileSync(join(tmpDir, "Movie.2020.1080p.BluRay.mkv"), "");
    const result = await renameFolder(tmpDir, jellyfinMovieVersionPattern, true);
    expect(result.operations.length).toBe(1);
    const name = result.operations[0].to.split("/").pop() ?? "";
    expect(name).toContain("[1080p Bluray]");
  });

  it("includes HDR tag in multi-version output", async () => {
    writeFileSync(join(tmpDir, "Movie.2020.2160p.HDR.mkv"), "");
    const result = await renameFolder(tmpDir, jellyfinMovieVersionPattern, true);
    const name = result.operations[0].to.split("/").pop() ?? "";
    expect(name).toContain("[4K HDR]");
  });

  it("includes REMUX and HDR together", async () => {
    writeFileSync(join(tmpDir, "Movie.2020.2160p.REMUX.HDR.mkv"), "");
    const result = await renameFolder(tmpDir, jellyfinMovieVersionPattern, true);
    const name = result.operations[0].to.split("/").pop() ?? "";
    expect(name).toContain("[4K Remux HDR]");
  });
});

// ---------------------------------------------------------------------------
// parseYoutubePattern
// ---------------------------------------------------------------------------
describe("parseYoutubePattern", () => {
  it("extracts video ID from yt-dlp naming", () => {
    const meta = parseYoutubePattern("My Cool Video [dQw4w9WgXcQ]");
    expect(meta.videoId).toBe("dQw4w9WgXcQ");
    expect(meta.title).toBe("My Cool Video");
  });

  it("extracts channel and title from Channel - Title format", () => {
    const meta = parseYoutubePattern("Tech Channel - How to Code [abc123DEF-_]");
    expect(meta.uploader).toBe("Tech Channel");
    expect(meta.title).toBe("How to Code");
    expect(meta.videoId).toBe("abc123DEF-_");
  });

  it("extracts date from YYYYMMDD prefix", () => {
    const meta = parseYoutubePattern("20240115 My Video [dQw4w9WgXcQ]");
    expect(meta.dateTaken).toBe("2024-01-15");
    expect(meta.videoId).toBe("dQw4w9WgXcQ");
  });

  it("handles filename without video ID", () => {
    const meta = parseYoutubePattern("Some Random Video");
    expect(meta.videoId).toBeUndefined();
    expect(meta.title).toBe("Some Random Video");
  });
});

// ---------------------------------------------------------------------------
// parseAnimePattern
// ---------------------------------------------------------------------------
describe("parseAnimePattern", () => {
  it("parses fansub format [Group] Title - 01", () => {
    const meta = parseAnimePattern("[SubGroup] Naruto - 42");
    expect(meta.title).toBe("Naruto");
    expect(meta.absoluteEpisode).toBe(42);
  });

  it("parses SxxExx format", () => {
    const meta = parseAnimePattern("Attack.on.Titan.S01E025.Episode.Title");
    expect(meta.title).toBe("Attack on Titan");
    expect(meta.season).toBe(1);
    expect(meta.absoluteEpisode).toBe(25);
  });

  it("parses absolute numbering with episode title", () => {
    const meta = parseAnimePattern("One Piece - 001 - Romance Dawn");
    expect(meta.title).toBe("One Piece");
    expect(meta.absoluteEpisode).toBe(1);
    expect(meta.episodeTitle).toBe("Romance Dawn");
  });

  it("strips trailing quality tags", () => {
    const meta = parseAnimePattern("[Fansub] Bleach - 42 [1080p]");
    expect(meta.absoluteEpisode).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// parsePodcastPattern
// ---------------------------------------------------------------------------
describe("parsePodcastPattern", () => {
  it("parses Show - Date - Episode format", () => {
    const meta = parsePodcastPattern("Tech Talk - 2024-03-10 - AI Revolution");
    expect(meta.showName).toBe("Tech Talk");
    expect(meta.dateTaken).toBe("2024-03-10");
    expect(meta.episodeTitle).toBe("AI Revolution");
  });

  it("parses Show - Date format", () => {
    const meta = parsePodcastPattern("My Podcast - 2024-01-01");
    expect(meta.showName).toBe("My Podcast");
    expect(meta.dateTaken).toBe("2024-01-01");
  });

  it("parses Date - Episode format", () => {
    const meta = parsePodcastPattern("2024-06-15 - Great Interview");
    expect(meta.dateTaken).toBe("2024-06-15");
    expect(meta.episodeTitle).toBe("Great Interview");
  });

  it("parses Show - Episode format (no date)", () => {
    const meta = parsePodcastPattern("Science Hour - The Universe");
    expect(meta.showName).toBe("Science Hour");
    expect(meta.episodeTitle).toBe("The Universe");
  });
});

// ---------------------------------------------------------------------------
// parseComicPattern
// ---------------------------------------------------------------------------
describe("parseComicPattern", () => {
  it("parses volume and chapter", () => {
    const meta = parseComicPattern("One Piece Vol 01 Ch 001");
    expect(meta.title).toBe("One Piece");
    expect(meta.volume).toBe(1);
    expect(meta.chapter).toBe(1);
  });

  it("parses issue number with #", () => {
    const meta = parseComicPattern("Batman #042");
    expect(meta.title).toBe("Batman");
    expect(meta.chapter).toBe(42);
  });

  it("parses volume only", () => {
    const meta = parseComicPattern("Spider-Man Volume 3");
    expect(meta.title).toBe("Spider-Man");
    expect(meta.volume).toBe(3);
  });

  it("parses Chapter keyword", () => {
    const meta = parseComicPattern("Naruto Chapter 100");
    expect(meta.chapter).toBe(100);
  });

  it("handles plain title with no volume or chapter", () => {
    const meta = parseComicPattern("Watchmen");
    expect(meta.title).toBe("Watchmen");
    expect(meta.volume).toBeUndefined();
    expect(meta.chapter).toBeUndefined();
  });
});
