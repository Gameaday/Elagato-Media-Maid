/**
 * Tests for src/lib/checksum.ts
 * SHA-256 manifest generation and verification.
 */

import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";

import {
  hashFile,
  hashDirectory,
  generateManifest,
  parseManifest,
  verifyManifest,
  MANIFEST_FILENAME
} from "../src/lib/checksum";

const TEST_ROOT = join(__dirname, "__checksum_test_tmp__");

beforeEach(() => {
  try { rmSync(TEST_ROOT, { recursive: true }); } catch { /* ignore */ }
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  try { rmSync(TEST_ROOT, { recursive: true }); } catch { /* ignore */ }
});

describe("hashFile", () => {
  it("computes SHA-256 hash of a file", async () => {
    const filePath = join(TEST_ROOT, "test.txt");
    writeFileSync(filePath, "hello world");
    const hash = await hashFile(filePath);
    // SHA-256 of "hello world"
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("produces different hashes for different content", async () => {
    const file1 = join(TEST_ROOT, "a.txt");
    const file2 = join(TEST_ROOT, "b.txt");
    writeFileSync(file1, "alpha");
    writeFileSync(file2, "beta");
    const h1 = await hashFile(file1);
    const h2 = await hashFile(file2);
    expect(h1).not.toBe(h2);
  });

  it("returns 64-character hex string", async () => {
    const filePath = join(TEST_ROOT, "hex.txt");
    writeFileSync(filePath, "test");
    const hash = await hashFile(filePath);
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });
});

describe("hashDirectory", () => {
  it("hashes all files in directory", async () => {
    writeFileSync(join(TEST_ROOT, "a.txt"), "alpha");
    writeFileSync(join(TEST_ROOT, "b.txt"), "beta");
    const results = await hashDirectory(TEST_ROOT);
    expect(results).toHaveLength(2);
    expect(results[0].filename).toBe("a.txt");
    expect(results[1].filename).toBe("b.txt");
  });

  it("skips the manifest file itself", async () => {
    writeFileSync(join(TEST_ROOT, "data.bin"), "data");
    writeFileSync(join(TEST_ROOT, MANIFEST_FILENAME), "old manifest");
    const results = await hashDirectory(TEST_ROOT);
    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe("data.bin");
  });

  it("returns sorted results", async () => {
    writeFileSync(join(TEST_ROOT, "z.txt"), "z");
    writeFileSync(join(TEST_ROOT, "a.txt"), "a");
    writeFileSync(join(TEST_ROOT, "m.txt"), "m");
    const results = await hashDirectory(TEST_ROOT);
    expect(results.map(r => r.filename)).toEqual(["a.txt", "m.txt", "z.txt"]);
  });

  it("includes file sizes", async () => {
    writeFileSync(join(TEST_ROOT, "data.txt"), "hello");
    const results = await hashDirectory(TEST_ROOT);
    expect(results[0].size).toBe(5);
  });

  it("returns empty array for empty directory", async () => {
    const results = await hashDirectory(TEST_ROOT);
    expect(results).toHaveLength(0);
  });
});

describe("generateManifest", () => {
  it("generates manifest file content", async () => {
    writeFileSync(join(TEST_ROOT, "file1.txt"), "content1");
    writeFileSync(join(TEST_ROOT, "file2.txt"), "content2");
    const content = await generateManifest(TEST_ROOT);
    expect(content).toContain("file1.txt");
    expect(content).toContain("file2.txt");
    // Format: "<hash>  <filename>"
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^[a-f0-9]{64}\s{2}.+$/);
  });

  it("writes manifest file to disk", async () => {
    writeFileSync(join(TEST_ROOT, "data.txt"), "hello");
    await generateManifest(TEST_ROOT, false);
    const manifestPath = join(TEST_ROOT, MANIFEST_FILENAME);
    expect(readFileSync(manifestPath, "utf-8")).toContain("data.txt");
  });

  it("does not write in dry-run mode", async () => {
    writeFileSync(join(TEST_ROOT, "data.txt"), "hello");
    const content = await generateManifest(TEST_ROOT, true);
    expect(content).toContain("data.txt");
    const manifestPath = join(TEST_ROOT, MANIFEST_FILENAME);
    expect(() => readFileSync(manifestPath)).toThrow();
  });

  it("returns empty string for empty directory", async () => {
    const content = await generateManifest(TEST_ROOT);
    expect(content).toBe("");
  });
});

describe("parseManifest", () => {
  it("parses standard sha256sum format", () => {
    const content = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1  file.txt\n";
    const map = parseManifest(content);
    expect(map.get("file.txt")).toBe("abc123def456abc123def456abc123def456abc123def456abc123def456abc1");
  });

  it("handles binary mode marker", () => {
    const content = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1 *file.bin\n";
    const map = parseManifest(content);
    expect(map.get("file.bin")).toBe("abc123def456abc123def456abc123def456abc123def456abc123def456abc1");
  });

  it("handles multiple lines", () => {
    const content = [
      "aaaa000000000000000000000000000000000000000000000000000000000000  a.txt",
      "bbbb000000000000000000000000000000000000000000000000000000000000  b.txt",
      ""
    ].join("\n");
    const map = parseManifest(content);
    expect(map.size).toBe(2);
  });

  it("skips blank lines", () => {
    const content = "\n\n  \n";
    const map = parseManifest(content);
    expect(map.size).toBe(0);
  });
});

describe("verifyManifest", () => {
  it("verifies files that match", async () => {
    writeFileSync(join(TEST_ROOT, "data.txt"), "hello");
    await generateManifest(TEST_ROOT);
    const result = await verifyManifest(TEST_ROOT);
    expect(result.passed).toContain("data.txt");
    expect(result.failed).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it("detects modified files", async () => {
    writeFileSync(join(TEST_ROOT, "data.txt"), "hello");
    await generateManifest(TEST_ROOT);
    // Modify the file after generating the manifest
    writeFileSync(join(TEST_ROOT, "data.txt"), "modified!");
    const result = await verifyManifest(TEST_ROOT);
    expect(result.failed).toContain("data.txt");
    expect(result.passed).toHaveLength(0);
  });

  it("detects missing files", async () => {
    writeFileSync(join(TEST_ROOT, "data.txt"), "hello");
    await generateManifest(TEST_ROOT);
    // Remove the file
    rmSync(join(TEST_ROOT, "data.txt"));
    const result = await verifyManifest(TEST_ROOT);
    expect(result.missing).toContain("data.txt");
    expect(result.total).toBe(1);
  });

  it("returns empty result when no manifest exists", async () => {
    const result = await verifyManifest(TEST_ROOT);
    expect(result.total).toBe(0);
    expect(result.passed).toHaveLength(0);
  });
});

describe("MANIFEST_FILENAME", () => {
  it("is checksums.sha256", () => {
    expect(MANIFEST_FILENAME).toBe("checksums.sha256");
  });
});
