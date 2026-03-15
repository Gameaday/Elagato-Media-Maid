/**
 * Checksum / integrity verification module for MediaMaid.
 *
 * Generates and verifies SHA-256 checksum manifests for archival integrity.
 * Follows the common pattern used by sha256sum / shasum tools:
 *
 *   <hash>  <filename>
 *
 * Supports:
 * - Generating manifests for a directory
 * - Verifying existing manifests
 * - Dry-run mode (preview without writing)
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { readdir, stat, readFile, writeFile } from "fs/promises";
import { join, basename } from "path";
import { logOperation } from "./logger.js";

/** Default manifest filename */
export const MANIFEST_FILENAME = "checksums.sha256";

/** Result of hashing a single file */
export interface HashResult {
  /** Relative filename */
  filename: string;
  /** SHA-256 hex digest */
  hash: string;
  /** File size in bytes */
  size: number;
}

/** Result of verifying a manifest */
export interface VerifyResult {
  /** Files that matched their expected hash */
  passed: string[];
  /** Files that did not match (hash mismatch) */
  failed: string[];
  /** Files listed in manifest but missing from disk */
  missing: string[];
  /** Total files checked */
  total: number;
}

/**
 * Compute the SHA-256 hash of a file using streaming (memory-efficient).
 */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Generate SHA-256 hashes for all files in a directory.
 * Skips subdirectories and the manifest file itself.
 *
 * @param folderPath - Directory to hash
 * @returns Array of hash results
 */
export async function hashDirectory(folderPath: string): Promise<HashResult[]> {
  const results: HashResult[] = [];

  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    return results;
  }

  // Sort for deterministic output
  entries.sort();

  for (const name of entries) {
    if (name === MANIFEST_FILENAME) continue;

    const fullPath = join(folderPath, name);
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) continue;

      const hash = await hashFile(fullPath);
      results.push({ filename: name, hash, size: fileStat.size });
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

/**
 * Generate a checksum manifest file (checksums.sha256) for a directory.
 *
 * @param folderPath - Directory to generate manifest for
 * @param dryRun     - If true, returns content without writing
 * @returns The manifest content as a string
 */
export async function generateManifest(
  folderPath: string,
  dryRun = false
): Promise<string> {
  const results = await hashDirectory(folderPath);

  if (results.length === 0) return "";

  // Format: "<hash>  <filename>\n" (two spaces, matching sha256sum)
  const lines = results.map(r => `${r.hash}  ${r.filename}`);
  const content = lines.join("\n") + "\n";

  if (!dryRun) {
    const manifestPath = join(folderPath, MANIFEST_FILENAME);
    await writeFile(manifestPath, content, "utf-8");
    logOperation({
      operation: "checksum",
      from: folderPath,
      to: manifestPath,
      message: `Generated SHA-256 manifest for ${results.length} file(s)`
    });
  }

  return content;
}

/**
 * Parse a checksum manifest file into filename→hash pairs.
 */
export function parseManifest(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "<hash>  <filename>" or "<hash> *<filename>" (binary mode)
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(trimmed);
    if (match) {
      map.set(match[2], match[1]);
    }
  }
  return map;
}

/**
 * Verify files in a directory against an existing checksum manifest.
 *
 * @param folderPath - Directory containing files and manifest
 * @param manifestFilename - Manifest filename (default: checksums.sha256)
 * @returns Verification results
 */
export async function verifyManifest(
  folderPath: string,
  manifestFilename = MANIFEST_FILENAME
): Promise<VerifyResult> {
  const result: VerifyResult = {
    passed: [],
    failed: [],
    missing: [],
    total: 0
  };

  const manifestPath = join(folderPath, manifestFilename);
  let content: string;
  try {
    content = await readFile(manifestPath, "utf-8");
  } catch {
    return result;
  }

  const expected = parseManifest(content);
  result.total = expected.size;

  for (const [filename, expectedHash] of expected) {
    const filePath = join(folderPath, filename);
    try {
      await stat(filePath);
    } catch {
      result.missing.push(filename);
      continue;
    }

    try {
      const actualHash = await hashFile(filePath);
      if (actualHash === expectedHash) {
        result.passed.push(filename);
      } else {
        result.failed.push(filename);
      }
    } catch {
      result.failed.push(filename);
    }
  }

  logOperation({
    operation: "verify",
    from: manifestPath,
    to: folderPath,
    message: `Verified ${result.passed.length}/${result.total} OK, ${result.failed.length} failed, ${result.missing.length} missing`
  });

  return result;
}
