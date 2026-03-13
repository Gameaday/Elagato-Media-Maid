/**
 * Tests for src/lib/undo-manager.ts
 */

import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";

// We need to override the undo file path during tests by controlling homedir
// We'll do this by mocking the 'os' module.
const MOCK_HOME = mkdtempSync(join(tmpdir(), "mediamaid-undo-home-"));

jest.mock("os", () => ({
  ...jest.requireActual("os"),
  homedir: () => MOCK_HOME
}));

// Import after mock is set up
import {
  pushUndoSnapshot,
  peekUndoSnapshot,
  popUndoSnapshot,
  applyUndo,
  createSnapshot,
  undoStackSize,
  _saveStack
} from "../src/lib/undo-manager";

afterAll(() => {
  rmSync(MOCK_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset the undo stack before each test
  _saveStack([]);
});

describe("createSnapshot", () => {
  it("creates a snapshot with the given label and operations", () => {
    const snap = createSnapshot("Test Op", [{ type: "rename", from: "/a", to: "/b" }]);
    expect(snap.label).toBe("Test Op");
    expect(snap.operations).toHaveLength(1);
    expect(snap.timestamp).toBeDefined();
  });
});

describe("pushUndoSnapshot / peekUndoSnapshot / popUndoSnapshot", () => {
  it("pushes and peeks a snapshot", () => {
    const snap = createSnapshot("Rename A", []);
    pushUndoSnapshot(snap);
    expect(peekUndoSnapshot()?.label).toBe("Rename A");
  });

  it("peeks the most recent snapshot", () => {
    pushUndoSnapshot(createSnapshot("First", []));
    pushUndoSnapshot(createSnapshot("Second", []));
    expect(peekUndoSnapshot()?.label).toBe("Second");
  });

  it("pops the most recent snapshot", () => {
    pushUndoSnapshot(createSnapshot("Pop Me", []));
    const popped = popUndoSnapshot();
    expect(popped?.label).toBe("Pop Me");
    expect(undoStackSize()).toBe(0);
  });

  it("returns undefined when stack is empty", () => {
    expect(peekUndoSnapshot()).toBeUndefined();
    expect(popUndoSnapshot()).toBeUndefined();
  });
});

describe("undoStackSize", () => {
  it("returns 0 for empty stack", () => {
    expect(undoStackSize()).toBe(0);
  });

  it("counts pushed snapshots", () => {
    pushUndoSnapshot(createSnapshot("A", []));
    pushUndoSnapshot(createSnapshot("B", []));
    expect(undoStackSize()).toBe(2);
  });

  it("caps at MAX_UNDO_SNAPSHOTS (10)", () => {
    for (let i = 0; i < 15; i++) {
      pushUndoSnapshot(createSnapshot(`Op ${i}`, []));
    }
    expect(undoStackSize()).toBe(10);
  });
});

describe("applyUndo", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mediamaid-undo-apply-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reverses a rename operation", async () => {
    const from = join(tmpDir, "original.mkv");
    const to   = join(tmpDir, "renamed.mkv");
    writeFileSync(to, ""); // simulate post-rename state

    const snap = createSnapshot("Test Rename", [{ type: "rename", from, to }]);
    const errors = await applyUndo(snap);

    expect(errors).toHaveLength(0);
    expect(existsSync(from)).toBe(true);
    expect(existsSync(to)).toBe(false);
  });

  it("returns errors for files that no longer exist", async () => {
    const snap = createSnapshot("Missing", [{
      type: "rename",
      from: join(tmpDir, "ghost.mkv"),
      to:   join(tmpDir, "nonexistent.mkv")
    }]);
    const errors = await applyUndo(snap);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("applies undo operations in reverse order", async () => {
    // We can't easily mock rename, but we can verify via a real filesystem test
    const fileA = join(tmpDir, "a.mkv");
    const fileB = join(tmpDir, "a_renamed.mkv");
    const fileC = join(tmpDir, "a_renamed2.mkv");

    writeFileSync(fileC, "");

    const snap = createSnapshot("Multi Rename", [
      { type: "rename", from: fileA, to: fileB },   // op1
      { type: "rename", from: fileB, to: fileC }    // op2 – should undo first
    ]);

    const errors = await applyUndo(snap);
    expect(errors).toHaveLength(0);
    // After undoing in reverse order: fileC → fileB, fileB → fileA
    expect(existsSync(fileA)).toBe(true);
    expect(existsSync(fileC)).toBe(false);
  });
});
