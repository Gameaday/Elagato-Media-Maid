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
  SORT_CATEGORIES,
  CATEGORY_MAP,
  TV_VIDEO_EXTENSIONS,
  PHOTO_EXTENSIONS,
  MUSIC_EXTENSIONS,
  BOOK_EXTENSIONS,
  DOC_EXTENSIONS,
  TV_EPISODE_RE,
  LONG_PRESS_MS,
  MAX_UNDO_SNAPSHOTS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MIN_CONFIDENCE,
  MIN_REFRESH_INTERVAL_S,
  validateFolderPath
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
    const sets = [VIDEO_EXTS, PHOTO_EXTS, AUDIO_EXTS, EBOOK_EXTS, DOCUMENT_EXTS];
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
  });

  it("all extensions start with a dot", () => {
    const allSets = [VIDEO_EXTS, PHOTO_EXTS, AUDIO_EXTS, EBOOK_EXTS, DOCUMENT_EXTS,
      INSTALLER_EXTS, ARCHIVE_EXTS, CODE_EXTS, NFO_EXTS, SUBTITLE_EXTS];
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
