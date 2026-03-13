/**
 * Tests for the NFO writer module.
 */

import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  getNfoTemplate,
  getNfoTypes,
  readNfoFields,
  writeNfoFile,
  detectNfoType,
  autoCreateNfo,
  type NfoType
} from "../src/lib/nfo-writer";

const TEST_ROOT = join(__dirname, ".tmp-nfowriter");

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("getNfoTemplate", () => {
  it("returns fields for all NFO types", () => {
    const types = getNfoTypes();
    expect(types).toContain("tvshow");
    expect(types).toContain("episode");
    expect(types).toContain("movie");
    expect(types).toContain("artist");
    expect(types).toContain("album");

    for (const type of types) {
      const fields = getNfoTemplate(type);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields[0]).toHaveProperty("tag");
      expect(fields[0]).toHaveProperty("label");
      expect(fields[0]).toHaveProperty("editable");
    }
  });

  it("returns independent copies (not shared references)", () => {
    const a = getNfoTemplate("movie");
    const b = getNfoTemplate("movie");
    a[0].value = "modified";
    expect(b[0].value).toBe("");
  });
});

describe("detectNfoType", () => {
  it("detects episode from SxxExx pattern", () => {
    expect(detectNfoType("/media/Show.S01E01.mkv")).toBe("episode");
  });

  it("detects movie from year in filename", () => {
    expect(detectNfoType("/media/Movie.2023.mkv")).toBe("movie");
  });

  it("detects album from audio extensions", () => {
    expect(detectNfoType("/media/track.flac")).toBe("album");
    expect(detectNfoType("/media/song.mp3")).toBe("album");
  });

  it("defaults to movie for unknown media", () => {
    expect(detectNfoType("/media/something.pdf")).toBe("movie");
  });
});

describe("writeNfoFile", () => {
  it("creates a new NFO file with correct XML structure", async () => {
    const nfoPath = join(TEST_ROOT, "test.nfo");
    const fields = getNfoTemplate("movie");
    fields[0].value = "Test Movie"; // title

    const result = await writeNfoFile(nfoPath, "movie", fields);
    expect(result.success).toBe(true);
    expect(existsSync(nfoPath)).toBe(true);

    const content = readFileSync(nfoPath, "utf-8");
    expect(content).toContain('<?xml version="1.0"');
    expect(content).toContain("<movie>");
    expect(content).toContain("<title>Test Movie</title>");
    expect(content).toContain("</movie>");
  });

  it("escapes XML special characters", async () => {
    const nfoPath = join(TEST_ROOT, "escape.nfo");
    const fields = getNfoTemplate("movie");
    fields[0].value = "Fast & Furious <3>"; // title with special chars

    await writeNfoFile(nfoPath, "movie", fields);
    const content = readFileSync(nfoPath, "utf-8");
    expect(content).toContain("Fast &amp; Furious &lt;3&gt;");
  });

  it("in dry-run mode, does not create any file", async () => {
    const nfoPath = join(TEST_ROOT, "dryrun.nfo");
    const fields = getNfoTemplate("movie");
    fields[0].value = "Test";

    const result = await writeNfoFile(nfoPath, "movie", fields, true);
    expect(result.success).toBe(true);
    expect(existsSync(nfoPath)).toBe(false);
  });
});

describe("readNfoFields", () => {
  it("reads fields from an existing NFO file", async () => {
    const nfoPath = join(TEST_ROOT, "existing.nfo");
    writeFileSync(nfoPath, `<?xml version="1.0"?>
<movie>
  <title>Inception</title>
  <year>2010</year>
  <genre>Sci-Fi</genre>
</movie>`);

    const { type, fields } = await readNfoFields(nfoPath);
    expect(type).toBe("movie");

    const titleField = fields.find(f => f.tag === "title");
    expect(titleField?.value).toBe("Inception");

    const yearField = fields.find(f => f.tag === "year");
    expect(yearField?.value).toBe("2010");
  });

  it("detects tvshow root tag", async () => {
    const nfoPath = join(TEST_ROOT, "tvshow.nfo");
    writeFileSync(nfoPath, `<tvshow><title>Breaking Bad</title></tvshow>`);

    const { type } = await readNfoFields(nfoPath);
    expect(type).toBe("tvshow");
  });

  it("detects episodedetails root tag", async () => {
    const nfoPath = join(TEST_ROOT, "episode.nfo");
    writeFileSync(nfoPath, `<episodedetails><title>Pilot</title><season>1</season></episodedetails>`);

    const { type, fields } = await readNfoFields(nfoPath);
    expect(type).toBe("episode");
    expect(fields.find(f => f.tag === "title")?.value).toBe("Pilot");
  });
});

describe("autoCreateNfo", () => {
  it("creates an NFO file from a media filename", async () => {
    const mediaPath = join(TEST_ROOT, "Movie.2023.mkv");
    writeFileSync(mediaPath, "");

    const result = await autoCreateNfo(mediaPath);
    expect(result.success).toBe(true);
    expect(existsSync(result.nfoPath)).toBe(true);

    const content = readFileSync(result.nfoPath, "utf-8");
    expect(content).toContain("<movie>");
  });

  it("uses overrides when provided", async () => {
    const mediaPath = join(TEST_ROOT, "video.mkv");
    writeFileSync(mediaPath, "");

    const result = await autoCreateNfo(mediaPath, { title: "Custom Title" });
    expect(result.success).toBe(true);

    const content = readFileSync(result.nfoPath, "utf-8");
    expect(content).toContain("<title>Custom Title</title>");
  });

  it("does not create in dry-run mode", async () => {
    const mediaPath = join(TEST_ROOT, "dryrun.mkv");
    writeFileSync(mediaPath, "");

    const result = await autoCreateNfo(mediaPath, undefined, true);
    expect(result.success).toBe(true);
    expect(existsSync(join(TEST_ROOT, "dryrun.nfo"))).toBe(false);
  });
});
