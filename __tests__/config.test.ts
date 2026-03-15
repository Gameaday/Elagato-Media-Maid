/**
 * Tests for the centralized config module.
 */

import {
  VIDEO_EXTS,
  PHOTO_EXTS,
  AUDIO_EXTS,
  EBOOK_EXTS,
  DOCUMENT_EXTS,
  INSTALLER_EXTS,
  ARCHIVE_EXTS,
  CODE_EXTS,
  NFO_EXTS,
  SUBTITLE_EXTS,
  ROM_EXTS,
  COMIC_EXTS,
  PODCAST_EXTS,
  ROM_EXTENSIONS,
  COMIC_EXTENSIONS,
  PODCAST_EXTENSIONS,
  YOUTUBE_EXTENSIONS,
  PLATFORM_MAP,
  SORT_CATEGORIES,
  CATEGORY_MAP,
  TV_VIDEO_EXTENSIONS,
  PHOTO_EXTENSIONS,
  MUSIC_EXTENSIONS,
  BOOK_EXTENSIONS,
  DOC_EXTENSIONS,
  TV_EPISODE_RE,
  YOUTUBE_ID_RE,
  ABSOLUTE_EPISODE_RE,
  COMIC_VOLUME_RE,
  COMIC_CHAPTER_RE,
  ROM_TAG_RE,
  ROM_REGION_RE,
  LONG_PRESS_MS,
  MAX_UNDO_SNAPSHOTS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MIN_CONFIDENCE,
  MIN_REFRESH_INTERVAL_S,
  validateFolderPath,
  SOURCE_TAG_RE,
  SOURCE_LABELS,
  HDR_TAG_RE,
  HDR_LABELS,
  COMPRESSIBLE_ROM_EXTS,
  DISC_ROM_EXTS,
  TRANSCODE_PRESETS
} from "../src/lib/config";

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_ROOT = join(__dirname, "__config_test_tmp__");

beforeEach(() => {
  try { rmSync(TEST_ROOT, { recursive: true }); } catch { /* ignore */ }
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  try { rmSync(TEST_ROOT, { recursive: true }); } catch { /* ignore */ }
});

describe("extension sets", () => {
  it("have no overlaps between primary content categories", () => {
    // Primary content categories should be mutually exclusive.
    // INSTALLER_EXTS, ARCHIVE_EXTS, CODE_EXTS, NFO_EXTS, SUBTITLE_EXTS are
    // excluded because they are ancillary categories that intentionally
    // overlap with some primary types (e.g. .pdf in both EBOOK and DOCUMENT
    // is handled by organizer sort priority, not set disjointness).
    const sets = [VIDEO_EXTS, PHOTO_EXTS, AUDIO_EXTS, EBOOK_EXTS, DOCUMENT_EXTS, ROM_EXTS];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const overlap = [...sets[i]].filter(e => sets[j].has(e));
        expect(overlap).toEqual([]);
      }
    }
  });

  it("all extension sets have entries", () => {
    expect(VIDEO_EXTS.size).toBeGreaterThan(0);
    expect(PHOTO_EXTS.size).toBeGreaterThan(0);
    expect(AUDIO_EXTS.size).toBeGreaterThan(0);
    expect(EBOOK_EXTS.size).toBeGreaterThan(0);
    expect(DOCUMENT_EXTS.size).toBeGreaterThan(0);
    expect(INSTALLER_EXTS.size).toBeGreaterThan(0);
    expect(ARCHIVE_EXTS.size).toBeGreaterThan(0);
    expect(CODE_EXTS.size).toBeGreaterThan(0);
    expect(NFO_EXTS.size).toBeGreaterThan(0);
    expect(SUBTITLE_EXTS.size).toBeGreaterThan(0);
    expect(ROM_EXTS.size).toBeGreaterThan(0);
  });

  it("all extensions start with a dot", () => {
    const allSets = [VIDEO_EXTS, PHOTO_EXTS, AUDIO_EXTS, EBOOK_EXTS, DOCUMENT_EXTS,
      INSTALLER_EXTS, ARCHIVE_EXTS, CODE_EXTS, NFO_EXTS, SUBTITLE_EXTS, ROM_EXTS];
    for (const set of allSets) {
      for (const ext of set) {
        expect(ext.startsWith(".")).toBe(true);
      }
    }
  });

  it("naming pattern extension arrays are subsets of their parent sets", () => {
    for (const ext of TV_VIDEO_EXTENSIONS) {
      expect(VIDEO_EXTS.has(ext)).toBe(true);
    }
    for (const ext of PHOTO_EXTENSIONS) {
      expect(PHOTO_EXTS.has(ext)).toBe(true);
    }
    for (const ext of MUSIC_EXTENSIONS) {
      expect(AUDIO_EXTS.has(ext)).toBe(true);
    }
    for (const ext of BOOK_EXTENSIONS) {
      expect(EBOOK_EXTS.has(ext)).toBe(true);
    }
    for (const ext of DOC_EXTENSIONS) {
      expect(DOCUMENT_EXTS.has(ext)).toBe(true);
    }
    for (const ext of ROM_EXTENSIONS) {
      expect(ROM_EXTS.has(ext)).toBe(true);
    }
  });
});

describe("SORT_CATEGORIES", () => {
  it("has unique folder names", () => {
    const names = SORT_CATEGORIES.map(c => c.folder);
    expect(new Set(names).size).toBe(names.length);
  });

  it("CATEGORY_MAP matches SORT_CATEGORIES", () => {
    for (const cat of SORT_CATEGORIES) {
      expect(CATEGORY_MAP[cat.folder]).toBe(cat.extensions);
    }
  });
});

describe("TV_EPISODE_RE", () => {
  it("matches S01E02 format", () => {
    expect(TV_EPISODE_RE.test("Show.S01E02.mkv")).toBe(true);
  });

  it("matches 1x02 format", () => {
    expect(TV_EPISODE_RE.test("Show.1x02.mkv")).toBe(true);
  });

  it("matches Season N", () => {
    expect(TV_EPISODE_RE.test("Season 1")).toBe(true);
  });

  it("does not match random strings", () => {
    expect(TV_EPISODE_RE.test("My Document.pdf")).toBe(false);
  });
});

describe("constants", () => {
  it("LONG_PRESS_MS is reasonable", () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(200);
    expect(LONG_PRESS_MS).toBeLessThanOrEqual(2000);
  });

  it("MAX_UNDO_SNAPSHOTS is reasonable", () => {
    expect(MAX_UNDO_SNAPSHOTS).toBeGreaterThanOrEqual(5);
    expect(MAX_UNDO_SNAPSHOTS).toBeLessThanOrEqual(100);
  });

  it("DEFAULT_MAX_DEPTH is reasonable", () => {
    expect(DEFAULT_MAX_DEPTH).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_MAX_DEPTH).toBeLessThanOrEqual(20);
  });

  it("DEFAULT_MIN_CONFIDENCE is in valid range", () => {
    expect(DEFAULT_MIN_CONFIDENCE).toBeGreaterThan(0);
    expect(DEFAULT_MIN_CONFIDENCE).toBeLessThan(1);
  });

  it("MIN_REFRESH_INTERVAL_S is reasonable", () => {
    expect(MIN_REFRESH_INTERVAL_S).toBeGreaterThanOrEqual(10);
  });
});

describe("validateFolderPath", () => {
  it("rejects empty string", () => {
    const result = validateFolderPath("");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No folder path");
  });

  it("rejects whitespace-only string", () => {
    const result = validateFolderPath("   ");
    expect(result.valid).toBe(false);
  });

  it("rejects non-existent path", () => {
    const result = validateFolderPath("/non/existent/path/xyz");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("does not exist");
  });

  it("accepts valid directory", () => {
    const result = validateFolderPath(TEST_ROOT);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects a file path (not a directory)", () => {
    writeFileSync(join(TEST_ROOT, "afile.txt"), "hello");
    const result = validateFolderPath(join(TEST_ROOT, "afile.txt"));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not a directory");
  });

  it("accepts directory with files", () => {
    writeFileSync(join(TEST_ROOT, "test.txt"), "hello");
    const result = validateFolderPath(TEST_ROOT);
    expect(result.valid).toBe(true);
  });
});

describe("ROM_EXTS", () => {
  it("contains common ROM extensions", () => {
    expect(ROM_EXTS.has(".nes")).toBe(true);
    expect(ROM_EXTS.has(".sfc")).toBe(true);
    expect(ROM_EXTS.has(".gba")).toBe(true);
    expect(ROM_EXTS.has(".n64")).toBe(true);
    expect(ROM_EXTS.has(".gen")).toBe(true);
    expect(ROM_EXTS.has(".nds")).toBe(true);
  });
});

describe("PLATFORM_MAP", () => {
  it("covers all extensions in ROM_EXTS", () => {
    for (const ext of ROM_EXTS) {
      expect(PLATFORM_MAP[ext]).toBeDefined();
    }
  });

  it("maps .nes to NES", () => {
    expect(PLATFORM_MAP[".nes"]).toBe("NES");
  });

  it("maps .gba to Game Boy Advance", () => {
    expect(PLATFORM_MAP[".gba"]).toBe("Game Boy Advance");
  });
});

describe("ROM_TAG_RE", () => {
  it("strips scene tags from ROM filenames", () => {
    const cleaned = "Super Mario [!] [h1]".replace(ROM_TAG_RE, "");
    expect(cleaned).toBe("Super Mario");
  });

  it("does not strip non-tag brackets", () => {
    const cleaned = "Game Title".replace(ROM_TAG_RE, "");
    expect(cleaned).toBe("Game Title");
  });
});

describe("ROM_REGION_RE", () => {
  it("extracts region from parenthesised tag", () => {
    const match = ROM_REGION_RE.exec("Game (USA)");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("USA");
  });

  it("extracts first region from multiple tags", () => {
    const match = ROM_REGION_RE.exec("Game (Japan, USA) (Rev A)");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Japan, USA");
  });
});

describe("SORT_CATEGORIES – ROMs", () => {
  it("includes a ROMs category", () => {
    const romCat = SORT_CATEGORIES.find(c => c.folder === "ROMs");
    expect(romCat).toBeDefined();
    expect(romCat!.extensions).toBe(ROM_EXTS);
  });
});

// ---------------------------------------------------------------------------
// Source tag regex
// ---------------------------------------------------------------------------
describe("SOURCE_TAG_RE", () => {
  it("matches BluRay", () => {
    expect(SOURCE_TAG_RE.test("Movie.1080p.BluRay.mkv")).toBe(true);
  });

  it("matches WEB-DL", () => {
    expect(SOURCE_TAG_RE.test("Movie.WEB-DL.1080p")).toBe(true);
  });

  it("matches REMUX", () => {
    expect(SOURCE_TAG_RE.test("Movie.2160p.REMUX")).toBe(true);
  });

  it("matches HDTV", () => {
    expect(SOURCE_TAG_RE.test("Show.HDTV.S01E01")).toBe(true);
  });

  it("does not match plain text", () => {
    expect(SOURCE_TAG_RE.test("my document.txt")).toBe(false);
  });
});

describe("SOURCE_LABELS", () => {
  it("normalises bluray to Bluray", () => {
    expect(SOURCE_LABELS["bluray"]).toBe("Bluray");
  });

  it("normalises web-dl to WEBDL", () => {
    expect(SOURCE_LABELS["web-dl"]).toBe("WEBDL");
  });

  it("normalises remux to Remux", () => {
    expect(SOURCE_LABELS["remux"]).toBe("Remux");
  });
});

// ---------------------------------------------------------------------------
// HDR tag regex
// ---------------------------------------------------------------------------
describe("HDR_TAG_RE", () => {
  it("matches HDR", () => {
    expect(HDR_TAG_RE.test("Movie.2160p.HDR")).toBe(true);
  });

  it("matches HDR10+", () => {
    expect(HDR_TAG_RE.test("Movie.HDR10+.mkv")).toBe(true);
  });

  it("matches DV shorthand", () => {
    expect(HDR_TAG_RE.test("Movie.DV.2160p")).toBe(true);
  });

  it("matches DoVi", () => {
    expect(HDR_TAG_RE.test("Movie.DoVi.mkv")).toBe(true);
  });

  it("does not match non-HDR content", () => {
    expect(HDR_TAG_RE.test("Movie.1080p.BluRay")).toBe(false);
  });
});

describe("HDR_LABELS", () => {
  it("normalises hdr to HDR", () => {
    expect(HDR_LABELS["hdr"]).toBe("HDR");
  });

  it("normalises dv to DV", () => {
    expect(HDR_LABELS["dv"]).toBe("DV");
  });

  it("normalises dovi to DV", () => {
    expect(HDR_LABELS["dovi"]).toBe("DV");
  });
});

// ---------------------------------------------------------------------------
// Compression config
// ---------------------------------------------------------------------------
describe("COMPRESSIBLE_ROM_EXTS", () => {
  it("includes cartridge-based ROM extensions", () => {
    expect(COMPRESSIBLE_ROM_EXTS.has(".nes")).toBe(true);
    expect(COMPRESSIBLE_ROM_EXTS.has(".sfc")).toBe(true);
    expect(COMPRESSIBLE_ROM_EXTS.has(".gba")).toBe(true);
    expect(COMPRESSIBLE_ROM_EXTS.has(".n64")).toBe(true);
  });

  it("does not include disc-based extensions", () => {
    expect(COMPRESSIBLE_ROM_EXTS.has(".iso")).toBe(false);
    expect(COMPRESSIBLE_ROM_EXTS.has(".bin")).toBe(false);
    expect(COMPRESSIBLE_ROM_EXTS.has(".wbfs")).toBe(false);
  });
});

describe("DISC_ROM_EXTS", () => {
  it("includes disc-based ROM extensions", () => {
    expect(DISC_ROM_EXTS.has(".iso")).toBe(true);
    expect(DISC_ROM_EXTS.has(".bin")).toBe(true);
    expect(DISC_ROM_EXTS.has(".gdi")).toBe(true);
    expect(DISC_ROM_EXTS.has(".wbfs")).toBe(true);
  });

  it("does not include cartridge-based extensions", () => {
    expect(DISC_ROM_EXTS.has(".nes")).toBe(false);
    expect(DISC_ROM_EXTS.has(".gba")).toBe(false);
  });
});

describe("TRANSCODE_PRESETS", () => {
  it("has hevc_hifi preset with slow, 10-bit, CRF 18", () => {
    expect(TRANSCODE_PRESETS.hevc_hifi).toBeDefined();
    expect(TRANSCODE_PRESETS.hevc_hifi.ffmpegArgs).toContain("libx265");
    expect(TRANSCODE_PRESETS.hevc_hifi.ffmpegArgs).toContain("slow");
    expect(TRANSCODE_PRESETS.hevc_hifi.ffmpegArgs).toContain("18");
    expect(TRANSCODE_PRESETS.hevc_hifi.ffmpegArgs).toContain("yuv420p10le");
  });

  it("has hevc_balanced preset with slow, 10-bit, CRF 22", () => {
    expect(TRANSCODE_PRESETS.hevc_balanced).toBeDefined();
    expect(TRANSCODE_PRESETS.hevc_balanced.ffmpegArgs).toContain("slow");
    expect(TRANSCODE_PRESETS.hevc_balanced.ffmpegArgs).toContain("22");
  });

  it("has hevc_compact preset with slow, 10-bit, CRF 26", () => {
    expect(TRANSCODE_PRESETS.hevc_compact).toBeDefined();
    expect(TRANSCODE_PRESETS.hevc_compact.ffmpegArgs).toContain("slow");
    expect(TRANSCODE_PRESETS.hevc_compact.ffmpegArgs).toContain("26");
  });

  it("has hevc_hdr preset with HDR metadata passthrough", () => {
    expect(TRANSCODE_PRESETS.hevc_hdr).toBeDefined();
    const argsStr = TRANSCODE_PRESETS.hevc_hdr.ffmpegArgs.join(" ");
    expect(argsStr).toContain("hdr-opt=1");
    expect(argsStr).toContain("bt2020");
    expect(argsStr).toContain("smpte2084");
  });

  it("has av1_quality preset with 10-bit", () => {
    expect(TRANSCODE_PRESETS.av1_quality).toBeDefined();
    expect(TRANSCODE_PRESETS.av1_quality.ffmpegArgs).toContain("libsvtav1");
    expect(TRANSCODE_PRESETS.av1_quality.ffmpegArgs).toContain("yuv420p10le");
  });

  it("has copy_mkv preset", () => {
    expect(TRANSCODE_PRESETS.copy_mkv).toBeDefined();
    expect(TRANSCODE_PRESETS.copy_mkv.ffmpegArgs).toContain("copy");
    expect(TRANSCODE_PRESETS.copy_mkv.outputExt).toBe(".mkv");
  });

  it("all presets have required fields", () => {
    for (const [, preset] of Object.entries(TRANSCODE_PRESETS)) {
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(Array.isArray(preset.ffmpegArgs)).toBe(true);
      expect(preset.outputExt).toBeTruthy();
    }
  });

  it("all re-encoding presets use 10-bit pixel format", () => {
    for (const key of ["hevc_hifi", "hevc_balanced", "hevc_compact", "hevc_hdr", "av1_quality"]) {
      expect(TRANSCODE_PRESETS[key].ffmpegArgs).toContain("yuv420p10le");
    }
  });

  it("HEVC streaming presets use AAC audio for compatibility", () => {
    for (const key of ["hevc_hifi", "hevc_balanced", "hevc_compact"]) {
      expect(TRANSCODE_PRESETS[key].ffmpegArgs).toContain("aac");
    }
  });
});

// ---------------------------------------------------------------------------
// Comic/Manga extension sets
// ---------------------------------------------------------------------------
describe("COMIC_EXTS", () => {
  it("contains common comic archive extensions", () => {
    expect(COMIC_EXTS.has(".cbz")).toBe(true);
    expect(COMIC_EXTS.has(".cbr")).toBe(true);
    expect(COMIC_EXTS.has(".cb7")).toBe(true);
    expect(COMIC_EXTS.has(".cbt")).toBe(true);
  });

  it("all extensions start with a dot", () => {
    for (const ext of COMIC_EXTS) {
      expect(ext.startsWith(".")).toBe(true);
    }
  });
});

describe("COMIC_EXTENSIONS", () => {
  it("is an array derived from COMIC_EXTS", () => {
    expect(Array.isArray(COMIC_EXTENSIONS)).toBe(true);
    for (const ext of COMIC_EXTENSIONS) {
      expect(COMIC_EXTS.has(ext)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Podcast extension set
// ---------------------------------------------------------------------------
describe("PODCAST_EXTS", () => {
  it("contains common podcast formats", () => {
    expect(PODCAST_EXTS.has(".mp3")).toBe(true);
    expect(PODCAST_EXTS.has(".m4a")).toBe(true);
    expect(PODCAST_EXTS.has(".ogg")).toBe(true);
    expect(PODCAST_EXTS.has(".opus")).toBe(true);
  });

  it("includes video podcast formats", () => {
    expect(PODCAST_EXTS.has(".mp4")).toBe(true);
  });
});

describe("PODCAST_EXTENSIONS", () => {
  it("is an array derived from PODCAST_EXTS", () => {
    expect(Array.isArray(PODCAST_EXTENSIONS)).toBe(true);
    for (const ext of PODCAST_EXTENSIONS) {
      expect(PODCAST_EXTS.has(ext)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// YouTube extensions
// ---------------------------------------------------------------------------
describe("YOUTUBE_EXTENSIONS", () => {
  it("includes video and audio extensions", () => {
    expect(YOUTUBE_EXTENSIONS).toContain(".mkv");
    expect(YOUTUBE_EXTENSIONS).toContain(".mp4");
    expect(YOUTUBE_EXTENSIONS).toContain(".mp3");
    expect(YOUTUBE_EXTENSIONS).toContain(".webm");
  });
});

// ---------------------------------------------------------------------------
// YouTube ID regex
// ---------------------------------------------------------------------------
describe("YOUTUBE_ID_RE", () => {
  it("matches standard yt-dlp filename with ID", () => {
    const match = YOUTUBE_ID_RE.exec("Video Title [dQw4w9WgXcQ].mp4");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("dQw4w9WgXcQ");
  });

  it("matches ID with hyphens and underscores", () => {
    const match = YOUTUBE_ID_RE.exec("Title [a_c-DEF12X4].webm");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("a_c-DEF12X4");
  });

  it("does not match shorter IDs", () => {
    expect(YOUTUBE_ID_RE.test("Title [abc123].mp4")).toBe(false);
  });

  it("does not match strings without brackets", () => {
    expect(YOUTUBE_ID_RE.test("Title dQw4w9WgXcQ.mp4")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Absolute episode regex
// ---------------------------------------------------------------------------
describe("ABSOLUTE_EPISODE_RE", () => {
  it("matches ' - 001' pattern", () => {
    const match = ABSOLUTE_EPISODE_RE.exec("Title - 001");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("001");
  });

  it("matches 'E01' pattern", () => {
    const match = ABSOLUTE_EPISODE_RE.exec("TitleE25");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("25");
  });

  it("matches 'EP001' pattern", () => {
    const match = ABSOLUTE_EPISODE_RE.exec("Title EP001");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("001");
  });
});

// ---------------------------------------------------------------------------
// Comic volume regex
// ---------------------------------------------------------------------------
describe("COMIC_VOLUME_RE", () => {
  it("matches Vol 01", () => {
    const match = COMIC_VOLUME_RE.exec("Series Vol 01");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("01");
  });

  it("matches Volume 3", () => {
    const match = COMIC_VOLUME_RE.exec("Series Volume 3");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("3");
  });

  it("matches v01", () => {
    const match = COMIC_VOLUME_RE.exec("Series v01");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("01");
  });
});

// ---------------------------------------------------------------------------
// Comic chapter regex
// ---------------------------------------------------------------------------
describe("COMIC_CHAPTER_RE", () => {
  it("matches Ch 001", () => {
    const match = COMIC_CHAPTER_RE.exec("Series Ch 001");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("001");
  });

  it("matches Chapter 100", () => {
    const match = COMIC_CHAPTER_RE.exec("Series Chapter 100");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("100");
  });

  it("matches #42", () => {
    const match = COMIC_CHAPTER_RE.exec("Batman #42");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// SORT_CATEGORIES – Comics
// ---------------------------------------------------------------------------
describe("SORT_CATEGORIES – Comics", () => {
  it("includes a Comics category", () => {
    const comicCat = SORT_CATEGORIES.find(c => c.folder === "Comics");
    expect(comicCat).toBeDefined();
    expect(comicCat!.extensions).toBe(COMIC_EXTS);
  });
});
