#!/usr/bin/env node
/**
 * Placeholder icon generator for the Media Maid Stream Deck plugin.
 *
 * manifest.json references image paths (icon, key, key-active, category) under
 * imgs/, and `streamdeck validate` requires each referenced file to exist as a
 * .png. The final artwork is not committed to the repository yet (see issue
 * #18), so this script generates simple placeholder PNGs.
 *
 * Rules:
 *  - Existing files are NEVER overwritten: once real artwork is committed,
 *    it wins automatically and placeholders stop being generated for it.
 *  - Pure Node.js, no dependencies (Buffer + node:zlib only).
 *
 * Usage: node scripts/gen-placeholder-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = join(REPO_ROOT, "com.gameaday.mediamaid.sdPlugin");

const ACTIVE_COLOR = "#4caf50"; // green "active" state
const BRAND_COLOR = "#ffd740"; // plugin icon / category tile

const ACTIONS = [
  { name: "smartfix", accent: "#ffc107", hasActive: true },
  { name: "quickrename", accent: "#4fc3f7", hasActive: true },
  { name: "nukedownloads", accent: "#ab47bc", hasActive: true },
  { name: "healer", accent: "#26a69a", hasActive: true },
  { name: "deepscan", accent: "#ef5350", hasActive: true },
  { name: "undo", accent: "#9e9e9e", hasActive: false },
  { name: "librarystats", accent: "#66bb6a", hasActive: false },
  { name: "nfoeditor", accent: "#ffa726", hasActive: true },
];

/* ---------- minimal PNG encoder ---------- */

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([head, typeBuf, data, crc]);
}

function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Paints a 256x256 RGB canvas: dark background, accent frame, accent disc. */
function render(accentHex) {
  const bg = rgb("#141a26");
  const accent = rgb(accentHex);
  const rows = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  const center = SIZE / 2;
  const frame = 10; // outer frame thickness (px)
  const discR = 72; // center disc radius (px)
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 3 + 1);
    rows[row] = 0; // filter type 0 (none)
    for (let x = 0; x < SIZE; x++) {
      const p = row + 1 + x * 3;
      let c = bg;
      if (x < frame || y < frame || x >= SIZE - frame || y >= SIZE - frame) {
        c = accent; // border frame
      } else {
        const dx = x - center;
        const dy = y - center;
        if (dx * dx + dy * dy <= discR * discR) c = accent; // center disc
      }
      rows[p] = c[0];
      rows[p + 1] = c[1];
      rows[p + 2] = c[2];
    }
  }
  return rows;
}

function encodePng(rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- generate targets ---------- */

const targets = [
  { file: join(PLUGIN_DIR, "imgs", "plugin", "icon.png"), accent: BRAND_COLOR },
  { file: join(PLUGIN_DIR, "imgs", "plugin", "category.png"), accent: BRAND_COLOR },
];
for (const action of ACTIONS) {
  const dir = join(PLUGIN_DIR, "imgs", "actions", action.name);
  targets.push({ file: join(dir, "icon.png"), accent: action.accent });
  targets.push({ file: join(dir, "key.png"), accent: action.accent });
  if (action.hasActive) {
    targets.push({ file: join(dir, "key-active.png"), accent: ACTIVE_COLOR });
  }
}

let created = 0;
for (const t of targets) {
  const display = relative(REPO_ROOT, t.file);
  if (existsSync(t.file)) {
    console.log(`  keep  ${display} (already present)`);
    continue;
  }
  mkdirSync(dirname(t.file), { recursive: true });
  writeFileSync(t.file, encodePng(render(t.accent)));
  created += 1;
  console.log(`  add   ${display}`);
}

console.log(`\nPlaceholder icons: ${created} created, ${targets.length - created} kept.`);
if (created > 0) {
  console.log(
    "Note: these are placeholders only. Real artwork is tracked in issue #18;" +
      " once committed, this script will not overwrite it."
  );
}
