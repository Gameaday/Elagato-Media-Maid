/**
 * Compression & Transcoding engine for MediaMaid (Experimental).
 *
 * Provides:
 * - ROM compression  — zip cartridge-based ROMs; recommend CHD for disc-based ROMs
 * - Collection archive — compress infrequently accessed files into zip archives
 * - Video transcode   — generate FFmpeg commands for video compression
 *
 * All destructive operations support dry-run mode and return undo-friendly results.
 * External tools (ffmpeg, chdman, 7z) are detected at runtime and never assumed.
 */

import { execFile } from "child_process";
import { createWriteStream } from "fs";
import { readdir, stat, rename } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { createDeflate } from "zlib";
import { pipeline } from "stream/promises";
import { createReadStream } from "fs";
import { logOperation } from "./logger.js";
import {
  COMPRESSIBLE_ROM_EXTS,
  DISC_ROM_EXTS,
  TRANSCODE_PRESETS,
  type TranscodePreset
} from "./config.js";

// ── Tool detection ─────────────────────────────────────────────────

export interface ToolStatus {
  /** Tool name (e.g. "ffmpeg", "chdman", "7z") */
  name: string;
  /** Whether the tool was found on PATH */
  available: boolean;
  /** Version string if available */
  version?: string;
}

/** Tool-specific flags used to check availability/version */
const TOOL_VERSION_FLAGS: Record<string, string[]> = {
  ffmpeg:  ["-version"],
  chdman:  [],             // chdman prints help/version with no arguments
  "7z":    ["--help"]
};

/**
 * Check if an external tool is available on the system PATH.
 * Returns availability and version info.
 */
export function detectTool(toolName: string): Promise<ToolStatus> {
  return new Promise((resolve) => {
    const args = TOOL_VERSION_FLAGS[toolName] ?? ["-version"];

    execFile(toolName, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ name: toolName, available: false });
        return;
      }
      const output = (stdout || stderr || "").trim();
      const firstLine = output.split("\n")[0] ?? "";
      resolve({ name: toolName, available: true, version: firstLine });
    });
  });
}

/**
 * Detect all supported external tools at once.
 */
export async function detectAllTools(): Promise<ToolStatus[]> {
  return Promise.all([
    detectTool("ffmpeg"),
    detectTool("chdman"),
    detectTool("7z")
  ]);
}

// ── Compression results ────────────────────────────────────────────

/** Estimated compression ratio for cartridge-based ROMs (40% savings) */
const CARTRIDGE_COMPRESSION_RATIO = 0.6;
/** Estimated compression ratio for disc-based ROMs via CHD (30% savings) */
const DISC_COMPRESSION_RATIO = 0.7;

export interface CompressOperation {
  /** Original file path */
  from: string;
  /** Compressed/output file path */
  to: string;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes (0 if dry-run or skipped) */
  compressedSize: number;
  /** Whether this was skipped (already compressed, unsupported, etc.) */
  skipped: boolean;
  /** Reason for skipping, if applicable */
  skipReason?: string;
}

export interface CompressResult {
  /** Individual operation results */
  operations: CompressOperation[];
  /** Total files processed */
  processed: number;
  /** Total files skipped */
  skipped: number;
  /** Total bytes saved (original - compressed) */
  bytesSaved: number;
  /** Errors by filename */
  errors: Record<string, string>;
}

// ── ROM compression ────────────────────────────────────────────────

/**
 * Classify ROM files in a directory into compressible (zip-friendly cartridge ROMs)
 * and disc-based (recommend CHD conversion) categories.
 */
export async function classifyRomFiles(
  folderPath: string
): Promise<{ compressible: string[]; discBased: string[]; other: string[] }> {
  const compressible: string[] = [];
  const discBased: string[] = [];
  const other: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    return { compressible, discBased, other };
  }

  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    const fullPath = join(folderPath, name);
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) continue;
    } catch {
      continue;
    }

    if (COMPRESSIBLE_ROM_EXTS.has(ext)) {
      compressible.push(name);
    } else if (DISC_ROM_EXTS.has(ext)) {
      discBased.push(name);
    } else {
      other.push(name);
    }
  }

  return { compressible, discBased, other };
}

/**
 * Estimate potential compression savings for ROM files in a folder.
 * Cartridge ROMs typically compress 30-70% with zip.
 * Disc-based ROMs compress 20-50% with CHD (varies greatly).
 */
export async function estimateRomCompression(
  folderPath: string
): Promise<{ cartridgeBytes: number; discBytes: number; estimatedSavings: number }> {
  const { compressible, discBased } = await classifyRomFiles(folderPath);

  let cartridgeBytes = 0;
  let discBytes = 0;

  for (const name of compressible) {
    try {
      const fileStat = await stat(join(folderPath, name));
      cartridgeBytes += fileStat.size;
    } catch {
      // skip
    }
  }

  for (const name of discBased) {
    try {
      const fileStat = await stat(join(folderPath, name));
      discBytes += fileStat.size;
    } catch {
      // skip
    }
  }

  // Conservative estimates: 40% savings for cartridge zips, 30% for disc CHD
  const estimatedSavings = Math.round(
    cartridgeBytes * (1 - CARTRIDGE_COMPRESSION_RATIO) +
    discBytes * (1 - DISC_COMPRESSION_RATIO)
  );

  return { cartridgeBytes, discBytes, estimatedSavings };
}

/**
 * Compress cartridge-based ROM files individually into .zip archives.
 * Each ROM file becomes "filename.zip" containing the original file.
 *
 * Uses Node.js zlib deflate for portability (no external tools needed).
 * The output is a raw deflate stream with .zip extension — for full zip
 * archive support with directories, external 7z/zip tool is preferred.
 *
 * @param folderPath - Directory containing ROM files
 * @param dryRun     - If true, estimates only, no actual compression
 * @returns          - Compression results with per-file details
 */
export async function compressRoms(
  folderPath: string,
  dryRun = false
): Promise<CompressResult> {
  const result: CompressResult = {
    operations: [],
    processed: 0,
    skipped: 0,
    bytesSaved: 0,
    errors: {}
  };

  const { compressible, discBased } = await classifyRomFiles(folderPath);

  // Process compressible cartridge ROMs
  for (const name of compressible) {
    const fromPath = join(folderPath, name);
    const toPath = join(folderPath, `${basename(name, extname(name))}.zip`);

    let originalSize: number;
    try {
      const fileStat = await stat(fromPath);
      originalSize = fileStat.size;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors[name] = msg;
      continue;
    }

    // Skip if zip already exists
    try {
      await stat(toPath);
      result.operations.push({
        from: fromPath, to: toPath,
        originalSize, compressedSize: 0,
        skipped: true, skipReason: "Compressed file already exists"
      });
      result.skipped++;
      continue;
    } catch {
      // Expected — zip doesn't exist yet
    }

    if (dryRun) {
      const estimatedSize = Math.round(originalSize * CARTRIDGE_COMPRESSION_RATIO); // ~40% compression
      result.operations.push({
        from: fromPath, to: toPath,
        originalSize, compressedSize: estimatedSize,
        skipped: false
      });
      result.bytesSaved += originalSize - estimatedSize;
      result.processed++;
      logOperation({ operation: "dryrun", from: fromPath, to: toPath, message: `DRY RUN – would compress (est. ${Math.round((1 - estimatedSize / originalSize) * 100)}% savings)` });
    } else {
      try {
        const readStream = createReadStream(fromPath);
        const deflateStream = createDeflate({ level: 6 });
        const writeStream = createWriteStream(toPath);

        await pipeline(readStream, deflateStream, writeStream);

        const compressedStat = await stat(toPath);
        const compressedSize = compressedStat.size;
        const saved = originalSize - compressedSize;

        result.operations.push({
          from: fromPath, to: toPath,
          originalSize, compressedSize,
          skipped: false
        });
        result.bytesSaved += saved;
        result.processed++;
        logOperation({ operation: "compress", from: fromPath, to: toPath, message: `Compressed ${Math.round((1 - compressedSize / originalSize) * 100)}% savings` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors[name] = msg;
        logOperation({ operation: "error", from: fromPath, to: toPath, message: msg });
      }
    }
  }

  // Report disc-based ROMs as recommendations (not auto-compressed)
  for (const name of discBased) {
    const fromPath = join(folderPath, name);
    let originalSize: number;
    try {
      const fileStat = await stat(fromPath);
      originalSize = fileStat.size;
    } catch {
      continue;
    }

    result.operations.push({
      from: fromPath,
      to: fromPath.replace(/\.[^.]+$/, ".chd"),
      originalSize,
      compressedSize: Math.round(originalSize * DISC_COMPRESSION_RATIO),
      skipped: true,
      skipReason: "Disc-based ROM — use chdman for best results"
    });
    result.skipped++;
  }

  return result;
}

// ── Video transcoding (experimental) ───────────────────────────────

export interface TranscodeCommand {
  /** The full command line to execute */
  command: string;
  /** Array form: [executable, ...args] */
  args: string[];
  /** Input file */
  input: string;
  /** Output file */
  output: string;
  /** Preset used */
  preset: TranscodePreset;
  /** Estimated output size (0 if unknown) */
  estimatedOutputSize: number;
}

/**
 * Build an FFmpeg transcode command for a video file.
 * Does NOT execute the command — returns the command for review/execution.
 *
 * @param inputPath  - Path to the input video file
 * @param presetName - Key from TRANSCODE_PRESETS
 * @param outputDir  - Optional output directory (defaults to same directory)
 * @returns          - Command details or null if preset not found
 */
export function buildTranscodeCommand(
  inputPath: string,
  presetName: string,
  outputDir?: string
): TranscodeCommand | null {
  const preset = TRANSCODE_PRESETS[presetName];
  if (!preset) return null;

  const inputBase = basename(inputPath, extname(inputPath));
  const dir = outputDir ?? dirname(inputPath);
  const output = join(dir, `${inputBase}${preset.outputExt}`);

  // Avoid overwriting input if output extension matches
  const finalOutput = output === inputPath
    ? join(dir, `${inputBase}_transcoded${preset.outputExt}`)
    : output;

  const args = ["-i", inputPath, ...preset.ffmpegArgs, "-y", finalOutput];

  return {
    command: `ffmpeg ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`,
    args: ["ffmpeg", ...args],
    input: inputPath,
    output: finalOutput,
    preset,
    estimatedOutputSize: 0
  };
}

/**
 * Build a chdman command to convert a disc image to CHD format.
 * Returns the command for review/execution.
 */
export function buildChdConvertCommand(
  inputPath: string,
  outputDir?: string
): TranscodeCommand | null {
  const ext = extname(inputPath).toLowerCase();
  if (!DISC_ROM_EXTS.has(ext) && ext !== ".iso" && ext !== ".bin" && ext !== ".gdi") {
    return null;
  }

  const inputBase = basename(inputPath, extname(inputPath));
  const dir = outputDir ?? dirname(inputPath);
  const output = join(dir, `${inputBase}.chd`);

  const args = ["createcd", "-i", inputPath, "-o", output];

  return {
    command: `chdman ${args.join(" ")}`,
    args: ["chdman", ...args],
    input: inputPath,
    output,
    preset: {
      label: "CHD Compression",
      description: "MAME Compressed Hunks of Data — lossless disc image compression",
      ffmpegArgs: [],
      outputExt: ".chd"
    },
    estimatedOutputSize: 0
  };
}

/**
 * Scan a folder and generate transcode commands for all video files.
 * Returns a list of commands that can be reviewed before execution.
 */
export async function planTranscode(
  folderPath: string,
  presetName: string
): Promise<TranscodeCommand[]> {
  const commands: TranscodeCommand[] = [];

  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    return commands;
  }

  const videoExts = new Set([
    ".mkv", ".mp4", ".avi", ".m4v", ".ts", ".mov", ".wmv", ".webm"
  ]);

  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (!videoExts.has(ext)) continue;

    const fullPath = join(folderPath, name);
    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) continue;
    } catch {
      continue;
    }

    const cmd = buildTranscodeCommand(fullPath, presetName);
    if (cmd) commands.push(cmd);
  }

  return commands;
}

/**
 * Execute a single transcode command using FFmpeg.
 * Requires ffmpeg to be available on PATH.
 * Returns a promise that resolves when transcoding completes.
 */
export function executeTranscode(cmd: TranscodeCommand): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const [executable, ...args] = cmd.args;
    execFile(executable, args, { timeout: 0, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        const msg = err.message || stderr || "Unknown transcode error";
        logOperation({ operation: "error", from: cmd.input, to: cmd.output, message: msg });
        resolve({ success: false, error: msg });
      } else {
        logOperation({ operation: "transcode", from: cmd.input, to: cmd.output, message: "OK" });
        resolve({ success: true });
      }
    });
  });
}
