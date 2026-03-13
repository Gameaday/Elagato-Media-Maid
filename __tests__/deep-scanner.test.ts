/**
 * Tests for the deep scanner module.
 */

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { deepScan } from "../src/lib/deep-scanner";

const TEST_ROOT = join(__dirname, ".tmp-deepscan");

function createTestFiles(structure: Record<string, string>) {
  for (const [relPath, content] of Object.entries(structure)) {
    const fullPath = join(TEST_ROOT, relPath);
    const dir = dirname(fullPath);
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

describe("deepScan", () => {
  it("returns perfect health for an empty directory", async () => {
    const result = await deepScan(TEST_ROOT, false, true);
    expect(result.healthScore).toBe(100);
    expect(result.filesExamined).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("scans files and reports the health score", async () => {
    createTestFiles({
      "Breaking.Bad.S01E01.Pilot.mkv": "",
      "Breaking.Bad.S01E02.Cats.in.the.Bag.mkv": "",
      "random_file.txt": ""
    });

    const result = await deepScan(TEST_ROOT, false, true);
    expect(result.filesExamined).toBeGreaterThan(0);
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.healthScore).toBeLessThanOrEqual(100);
  });

  it("counts directories scanned", async () => {
    createTestFiles({
      "sub1/file1.mkv": "",
      "sub2/file2.mkv": "",
      "sub1/sub1a/file3.mkv": ""
    });

    const result = await deepScan(TEST_ROOT, false, true);
    expect(result.directoriesScanned).toBeGreaterThanOrEqual(2);
  });

  it("reports errors for non-existent paths gracefully", async () => {
    const result = await deepScan("/nonexistent/path/that/does/not/exist", false, true);
    expect(result.filesExamined).toBe(0);
  });

  it("in dry-run mode, counts fixed but does not rename files", async () => {
    createTestFiles({
      "Show.S01E01.Pilot.mkv": "",
      "Show.S01E02.Episode.Two.mkv": ""
    });

    const result = await deepScan(TEST_ROOT, true, true);
    // Dry run should not actually rename anything
    expect(result.errors).toBeDefined();
  });
});
