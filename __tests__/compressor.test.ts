/**
 * Tests for src/lib/compressor.ts
 * Tests ROM classification, compression estimation, transcode commands, and tool detection.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

import {
  classifyRomFiles,
  estimateRomCompression,
  buildTranscodeCommand,
  buildChdConvertCommand,
  planTranscode,
  detectTool
} from "../src/lib/compressor";

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mediamaid-compressor-"));
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// classifyRomFiles
// ---------------------------------------------------------------------------
describe("classifyRomFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => cleanupDir(tmpDir));

  it("classifies cartridge ROMs as compressible", async () => {
    writeFileSync(join(tmpDir, "mario.nes"), "x".repeat(256));
    writeFileSync(join(tmpDir, "zelda.sfc"), "x".repeat(512));
    writeFileSync(join(tmpDir, "pokemon.gba"), "x".repeat(1024));

    const result = await classifyRomFiles(tmpDir);
    expect(result.compressible).toHaveLength(3);
    expect(result.discBased).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  it("classifies disc-based ROMs separately", async () => {
    writeFileSync(join(tmpDir, "game.iso"), "x".repeat(1024));
    writeFileSync(join(tmpDir, "game.bin"), "x".repeat(512));
    writeFileSync(join(tmpDir, "game.wbfs"), "x".repeat(2048));

    const result = await classifyRomFiles(tmpDir);
    expect(result.compressible).toHaveLength(0);
    expect(result.discBased).toHaveLength(3);
  });

  it("handles mixed collections", async () => {
    writeFileSync(join(tmpDir, "mario.nes"), "x");
    writeFileSync(join(tmpDir, "game.iso"), "x");
    writeFileSync(join(tmpDir, "readme.txt"), "x");

    const result = await classifyRomFiles(tmpDir);
    expect(result.compressible).toHaveLength(1);
    expect(result.discBased).toHaveLength(1);
    expect(result.other).toHaveLength(1);
  });

  it("returns empty arrays for nonexistent folder", async () => {
    const result = await classifyRomFiles("/nonexistent/path");
    expect(result.compressible).toHaveLength(0);
    expect(result.discBased).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  it("returns empty arrays for empty folder", async () => {
    const result = await classifyRomFiles(tmpDir);
    expect(result.compressible).toHaveLength(0);
    expect(result.discBased).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// estimateRomCompression
// ---------------------------------------------------------------------------
describe("estimateRomCompression", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => cleanupDir(tmpDir));

  it("estimates savings for cartridge ROMs", async () => {
    // Write 1000 bytes of data
    writeFileSync(join(tmpDir, "game.nes"), "x".repeat(1000));

    const result = await estimateRomCompression(tmpDir);
    expect(result.cartridgeBytes).toBe(1000);
    expect(result.discBytes).toBe(0);
    expect(result.estimatedSavings).toBe(400); // 40% of 1000
  });

  it("estimates savings for disc-based ROMs", async () => {
    writeFileSync(join(tmpDir, "game.iso"), "x".repeat(1000));

    const result = await estimateRomCompression(tmpDir);
    expect(result.cartridgeBytes).toBe(0);
    expect(result.discBytes).toBe(1000);
    expect(result.estimatedSavings).toBe(300); // 30% of 1000
  });

  it("combines savings from both types", async () => {
    writeFileSync(join(tmpDir, "cart.nes"), "x".repeat(1000));
    writeFileSync(join(tmpDir, "disc.iso"), "x".repeat(1000));

    const result = await estimateRomCompression(tmpDir);
    expect(result.cartridgeBytes).toBe(1000);
    expect(result.discBytes).toBe(1000);
    expect(result.estimatedSavings).toBe(700); // 400 + 300
  });

  it("returns zeros for empty folder", async () => {
    const result = await estimateRomCompression(tmpDir);
    expect(result.cartridgeBytes).toBe(0);
    expect(result.discBytes).toBe(0);
    expect(result.estimatedSavings).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildTranscodeCommand
// ---------------------------------------------------------------------------
describe("buildTranscodeCommand", () => {
  it("builds HEVC high-fidelity command with 10-bit and slow preset", () => {
    const cmd = buildTranscodeCommand("/movies/test.mp4", "hevc_hifi");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("ffmpeg");
    expect(cmd!.command).toContain("libx265");
    expect(cmd!.command).toContain("-crf");
    expect(cmd!.command).toContain("18");
    expect(cmd!.command).toContain("slow");
    expect(cmd!.command).toContain("yuv420p10le");
    expect(cmd!.output).toContain(".mkv");
    expect(cmd!.input).toBe("/movies/test.mp4");
  });

  it("builds HEVC balanced command", () => {
    const cmd = buildTranscodeCommand("/movies/test.avi", "hevc_balanced");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("-crf");
    expect(cmd!.command).toContain("22");
    expect(cmd!.command).toContain("slow");
    expect(cmd!.command).toContain("yuv420p10le");
  });

  it("builds HEVC compact command", () => {
    const cmd = buildTranscodeCommand("/movies/test.avi", "hevc_compact");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("-crf");
    expect(cmd!.command).toContain("26");
    expect(cmd!.command).toContain("slow");
  });

  it("builds HEVC HDR preserve command with HDR metadata", () => {
    const cmd = buildTranscodeCommand("/movies/test.mp4", "hevc_hdr");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("hdr-opt=1");
    expect(cmd!.command).toContain("bt2020");
    expect(cmd!.command).toContain("smpte2084");
    expect(cmd!.command).toContain("yuv420p10le");
    // Should NOT hardcode master-display — FFmpeg copies from source
    expect(cmd!.command).not.toContain("master-display=");
    // HDR preset preserves original audio rather than re-encoding
    expect(cmd!.preset.ffmpegArgs).toContain("-c:a");
    expect(cmd!.preset.ffmpegArgs).toContain("copy");
  });

  it("builds AV1 quality command with 10-bit and opus audio", () => {
    const cmd = buildTranscodeCommand("/movies/test.mkv", "av1_quality");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("libsvtav1");
    expect(cmd!.command).toContain("28");
    expect(cmd!.command).toContain("yuv420p10le");
    expect(cmd!.command).toContain("libopus");
  });

  it("builds copy/remux command", () => {
    const cmd = buildTranscodeCommand("/movies/test.avi", "copy_mkv");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("-c");
    expect(cmd!.command).toContain("copy");
    expect(cmd!.output).toContain(".mkv");
  });

  it("returns null for unknown preset", () => {
    const cmd = buildTranscodeCommand("/movies/test.mp4", "nonexistent");
    expect(cmd).toBeNull();
  });

  it("avoids overwriting input when extensions match", () => {
    const cmd = buildTranscodeCommand("/movies/test.mkv", "hevc_balanced");
    expect(cmd).not.toBeNull();
    // Output should be different from input since both are .mkv
    expect(cmd!.output).not.toBe(cmd!.input);
  });

  it("uses custom output directory when provided", () => {
    const cmd = buildTranscodeCommand("/movies/test.mp4", "hevc_balanced", "/output");
    expect(cmd).not.toBeNull();
    expect(cmd!.output).toContain("/output/");
  });

  it("all presets include streaming-friendly flags", () => {
    // Non-remux presets that re-encode should use slow preset and 10-bit
    for (const presetName of ["hevc_hifi", "hevc_balanced", "hevc_compact", "hevc_hdr", "av1_quality"]) {
      const cmd = buildTranscodeCommand("/movies/test.mp4", presetName);
      expect(cmd).not.toBeNull();
      expect(cmd!.command).toContain("yuv420p10le");
    }
  });
});

// ---------------------------------------------------------------------------
// buildChdConvertCommand
// ---------------------------------------------------------------------------
describe("buildChdConvertCommand", () => {
  it("builds CHD command for ISO files", () => {
    const cmd = buildChdConvertCommand("/roms/game.iso");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain("chdman");
    expect(cmd!.command).toContain("createcd");
    expect(cmd!.output).toContain(".chd");
  });

  it("builds CHD command for BIN files", () => {
    const cmd = buildChdConvertCommand("/roms/game.bin");
    expect(cmd).not.toBeNull();
    expect(cmd!.output).toContain("game.chd");
  });

  it("builds CHD command for GDI files", () => {
    const cmd = buildChdConvertCommand("/roms/game.gdi");
    expect(cmd).not.toBeNull();
  });

  it("returns null for non-disc ROM files", () => {
    const cmd = buildChdConvertCommand("/roms/mario.nes");
    expect(cmd).toBeNull();
  });

  it("returns null for non-ROM files", () => {
    const cmd = buildChdConvertCommand("/docs/readme.txt");
    expect(cmd).toBeNull();
  });

  it("uses custom output directory", () => {
    const cmd = buildChdConvertCommand("/roms/game.iso", "/compressed");
    expect(cmd).not.toBeNull();
    expect(cmd!.output).toContain("/compressed/");
  });
});

// ---------------------------------------------------------------------------
// planTranscode
// ---------------------------------------------------------------------------
describe("planTranscode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => cleanupDir(tmpDir));

  it("generates commands for video files only", async () => {
    writeFileSync(join(tmpDir, "movie.mkv"), "x");
    writeFileSync(join(tmpDir, "show.mp4"), "x");
    writeFileSync(join(tmpDir, "readme.txt"), "x");
    writeFileSync(join(tmpDir, "photo.jpg"), "x");

    const commands = await planTranscode(tmpDir, "hevc_balanced");
    expect(commands).toHaveLength(2);
    expect(commands.every(c => c.command.includes("ffmpeg"))).toBe(true);
  });

  it("returns empty array for nonexistent folder", async () => {
    const commands = await planTranscode("/nonexistent", "hevc_balanced");
    expect(commands).toHaveLength(0);
  });

  it("returns empty array for folder with no videos", async () => {
    writeFileSync(join(tmpDir, "readme.txt"), "x");
    const commands = await planTranscode(tmpDir, "hevc_balanced");
    expect(commands).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectTool
// ---------------------------------------------------------------------------
describe("detectTool", () => {
  it("returns available=false for nonexistent tool", async () => {
    const result = await detectTool("definitely_not_a_real_tool_12345");
    expect(result.available).toBe(false);
    expect(result.name).toBe("definitely_not_a_real_tool_12345");
  });

  // Note: ffmpeg may or may not be installed in CI, so we just test the interface
  it("returns a ToolStatus object with correct shape", async () => {
    const result = await detectTool("node");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("available");
    expect(typeof result.available).toBe("boolean");
  });
});
