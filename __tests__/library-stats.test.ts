/**
 * Tests for the library stats module.
 */

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { calculateLibraryStats } from "../src/lib/library-stats";

const TEST_ROOT = join(__dirname, ".tmp-libstats");

function createTestFiles(structure: Record<string, string | Buffer>) {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = join(TEST_ROOT, relPath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
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

describe("calculateLibraryStats", () => {
  it("returns zero counts for an empty directory", () => {
    const stats = calculateLibraryStats(TEST_ROOT);
    expect(stats.totalFiles).toBe(0);
    expect(stats.totalSizeBytes).toBe(0);
    expect(stats.totalSizeFormatted).toBe("0 B");
    expect(stats.displayStats.length).toBeGreaterThan(0);
  });

  it("counts files by category", () => {
    createTestFiles({
      "video1.mkv": "x".repeat(100),
      "video2.mp4": "x".repeat(200),
      "photo.jpg": "x".repeat(50),
      "song.mp3": "x".repeat(75),
      "readme.txt": "hello"
    });

    const stats = calculateLibraryStats(TEST_ROOT);
    expect(stats.totalFiles).toBe(5);
    expect(stats.categoryCounts["Video"]).toBe(2);
    expect(stats.categoryCounts["Photo"]).toBe(1);
    expect(stats.categoryCounts["Audio"]).toBe(1);
    expect(stats.categoryCounts["Doc"]).toBe(1);
  });

  it("counts total size correctly", () => {
    createTestFiles({
      "file1.mkv": "a".repeat(1000),
      "file2.mp4": "b".repeat(2000)
    });

    const stats = calculateLibraryStats(TEST_ROOT);
    expect(stats.totalSizeBytes).toBe(3000);
    expect(stats.totalSizeFormatted).toContain("KB");
  });

  it("includes displayStats for touchscreen cycling", () => {
    createTestFiles({
      "movie.mkv": "x",
      "photo.jpg": "y"
    });

    const stats = calculateLibraryStats(TEST_ROOT);
    const labels = stats.displayStats.map(s => s.label);
    expect(labels).toContain("Total Files");
    expect(labels).toContain("Total Size");
    expect(labels).toContain("Media Type");
    expect(labels).toContain("Confidence");
  });

  it("recursively scans subdirectories", () => {
    createTestFiles({
      "level1/file1.mkv": "x",
      "level1/level2/file2.mp4": "y",
      "level1/level2/level3/file3.avi": "z"
    });

    const stats = calculateLibraryStats(TEST_ROOT);
    expect(stats.totalFiles).toBe(3);
    expect(stats.categoryCounts["Video"]).toBe(3);
  });

  it("detects media type and confidence", () => {
    createTestFiles({
      "show.S01E01.mkv": "x",
      "show.S01E02.mkv": "x",
      "show.S01E03.mkv": "x"
    });

    const stats = calculateLibraryStats(TEST_ROOT);
    expect(stats.detectedType).toBeDefined();
    expect(stats.confidence).toBeGreaterThanOrEqual(0);
    expect(stats.confidence).toBeLessThanOrEqual(1);
  });
});
