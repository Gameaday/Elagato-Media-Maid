# MediaMaid — Code Audit (October 2026)

Pre-Marketplace correctness pass over `src/` (plugin entry, lib layer, 8 actions). Companion to
`PRELAUNCH_AUDIT.md` (packaging/readiness) — this file covers code quality.

Method: full read of plugin.ts, undo-manager.ts, renamer.ts, nuke-downloads.ts, config.ts;
structural review of the remaining lib modules and the 13 test files.

## Verdict

The core is genuinely well designed for a v1.0 product:

- Every file-modifying path is guarded: folder validation, dry-run previews (long-press),
  per-file error isolation (one bad file never aborts the batch), and undo snapshots
  persisted to ~/.mediamaid/undo-stack.json, reverted in reverse order (mkdir removal only
  when empty, nfo-write content restored or file removed).
- renameFolder deconflicts against both a live tracking set and the real filesystem.
- Centralized config (timing, limits, extension registry) keeps the codebase DRY.
- 13 test files cover the lib layer.

Two real bugs were found; both are fixed in this commit.

## Fixed in this commit

| # | Severity | Where | Bug | Fix |
|---|----------|-------|-----|-----|
| 1 | **High** | renamer.ts `organizeWithFolderStructure` | `fs.rename()` silently **replaces** an existing file at the destination on every platform — organizing "Episode 1.mkv" into a folder that already contained one overwrote it (data loss) | Route the destination through `deconflict()` unless it is the source itself or a case-variant of it |
| 2 | Medium | renamer.ts `renameFolder` | Case-only renames (casing fixes) on Windows/macOS: `deconflict()` saw the source file itself as a collision, so every case fix became "name (2).ext" | Skip deconflict when the target differs from the source only by casing (real conflicts still deconflict on case-sensitive filesystems) |

## Flagged — need Carl's decision

### Action name: "Nuke Downloads"
The action **sorts** files into category subfolders, but the name (and docs) says "nuke", which
reads as deletion. For a Marketplace listing this will scare buyers and generate support load.
Recommend renaming to "Sort Downloads" **before** first Marketplace publish — action names and
UUIDs are hard to change once users have them on profiles.

### Minor / by design (documenting, not changing)
- Undo stack is global across all action instances (one shared stack in ~/.mediamaid). Fine for
  1.0 — document as intended behavior.
- Rename/organize operate on the top level of the chosen folder only; Deep Scan handles the
  tree (by design).
- `nfo-parser.ts` has no dedicated test file (nfo-writer and the rest of the lib are covered).
- Suggest regression tests for the two fixes above (renameFolder case-only rename, organizer
  overwrite guard) — CI runs jest on push.

## Design-quality check ("is each product answering one core case well?")

MediaMaid answers one core case well: *make my downloaded media library naming clean — safely,
from the Stream Deck.* No sprawl found: renamer, organizer, healer, deep-scan and stats all serve
that single mission; transcode/compressor scope stays inside it. Verdict: ship after the
"Nuke Downloads" naming decision.
