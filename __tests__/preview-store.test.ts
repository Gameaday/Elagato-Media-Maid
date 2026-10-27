/**
 * Tests for src/lib/preview-store.ts (#11)
 *
 * The store persists the last dry-run preview to
 * ~/.mediamaid/last-preview.json; homedir is mocked so tests never
 * touch the real home directory.
 */

import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";

// Override homedir so the preview file lands in a throwaway directory.
const MOCK_HOME = mkdtempSync(join(tmpdir(), "mediamaid-preview-home-"));

jest.mock("os", () => ({
  ...jest.requireActual("os"),
  homedir: () => MOCK_HOME
}));

// Import after mock is set up
import { saveLastPreview, loadLastPreview } from "../src/lib/preview-store";
import type { DryRunPreview } from "../src/lib/preview-store";
import { MediaType } from "../src/lib/patterns";

const PREVIEW_DIR = join(MOCK_HOME, ".mediamaid");
const PREVIEW_PATH = join(PREVIEW_DIR, "last-preview.json");

afterAll(() => {
  rmSync(MOCK_HOME, { recursive: true, force: true });
});

function makePreview(overrides: Partial<DryRunPreview> = {}): DryRunPreview {
  return {
    timestamp: "2026-10-27T00:00:00.000Z",
    patternLabel: "Jellyfin TV",
    mediaType: MediaType.JELLYFIN_TV,
    folder: "/media/tv",
    createFolderStructure: false,
    changed: [
      { from: "/media/tv/a.mkv", to: "/media/tv/Show - S01E01.mkv" }
    ],
    unchangedCount: 2,
    errorCount: 0,
    ...overrides
  };
}

describe("saveLastPreview / loadLastPreview", () => {
  it("round-trips a preview", () => {
    saveLastPreview(makePreview());

    const loaded = loadLastPreview();
    expect(loaded).toBeDefined();
    expect(loaded?.patternLabel).toBe("Jellyfin TV");
    expect(loaded?.folder).toBe("/media/tv");
    expect(loaded?.createFolderStructure).toBe(false);
    expect(loaded?.changed).toEqual([
      { from: "/media/tv/a.mkv", to: "/media/tv/Show - S01E01.mkv" }
    ]);
    expect(loaded?.unchangedCount).toBe(2);
    expect(loaded?.errorCount).toBe(0);
  });

  it("overwrites the previous preview", () => {
    saveLastPreview(makePreview({ patternLabel: "First" }));
    saveLastPreview(makePreview({ patternLabel: "Second" }));

    expect(loadLastPreview()?.patternLabel).toBe("Second");
  });

  it("leaves no temp file behind (atomic write)", () => {
    saveLastPreview(makePreview());

    expect(existsSync(PREVIEW_PATH)).toBe(true);
    expect(existsSync(`${PREVIEW_PATH}.tmp`)).toBe(false);
  });
});

describe("loadLastPreview error handling", () => {
  beforeEach(() => {
    rmSync(PREVIEW_DIR, { recursive: true, force: true });
  });

  it("returns undefined when no preview exists", () => {
    expect(loadLastPreview()).toBeUndefined();
  });

  it("returns undefined for a corrupt preview file", () => {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(PREVIEW_PATH, "not json {{{", "utf-8");

    expect(loadLastPreview()).toBeUndefined();
  });

  it("returns undefined for a structurally invalid preview", () => {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(PREVIEW_PATH, JSON.stringify({ patternLabel: 42 }), "utf-8");

    expect(loadLastPreview()).toBeUndefined();
  });

  it("returns undefined when changed is not an array", () => {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(
      PREVIEW_PATH,
      JSON.stringify({ patternLabel: "x", folder: "/f", changed: "nope" }),
      "utf-8"
    );

    expect(loadLastPreview()).toBeUndefined();
  });
});
