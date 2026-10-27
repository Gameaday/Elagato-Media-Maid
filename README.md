# MediaMaid – Stream Deck Plugin

> The Ultimate Tactile Media & File Archivist for Stream Deck

MediaMaid is a free, open-source [Elgato Stream Deck](https://www.elgato.com/en/stream-deck) plugin that turns your Stream Deck into a command centre for file organisation. Replace tedious manual renaming and expensive third-party subscriptions with one-touch automation — perfect for Jellyfin/Plex curators, photographers, music archivists, and data hoarders.

---

## Features

MediaMaid ships **8 actions**. Every action that writes files also runs on Stream Deck+ dials, with live feedback on the touchscreen.

### 🎬 Quick Rename
Instantly rename all compatible files in a folder to a chosen standard:

| Standard | Example output |
|---|---|
| Jellyfin / Plex – TV Show | `Breaking Bad - S01E04 - Cancer Man.mkv` |
| Jellyfin / Plex – Movie | `Inception (2010).mkv` |
| Jellyfin / Plex – Movie (multi-version) | `Inception (2010) [4K HDR DV].mkv` |
| Anime (absolute numbering) | `Mushoku Tensei - 01.mkv` |
| Photography | `2024-06-15_Paris_003.jpg` |
| Music | `01 - Led Zeppelin - Stairway to Heaven.flac` |
| Books / eBooks | `Isaac Asimov - Foundation.epub` |
| Comics / Manga | `One Piece - Vol 01 Ch 001.cbz` |
| Emulation ROMs | `Super Mario Bros. (USA) [!].nes` → clean name + platform folders |
| Podcasts | `Show Name - 2024-01-15 - Episode Title.mp3` |
| YouTube archives | `Channel - Video Title [dQw4w9WgXcQ].mkv` |
| Documents | `2024-06-15_Meeting Notes.pdf` |

- **Short press** → apply renames  
- **Long press (> 0.5 s)** → dry-run preview (logged, no files changed)  
- Optional: create folder structure alongside renaming (Season folders, Artist/Album, ROM platform folders, etc.)

Metadata is parsed from filenames using intelligent heuristics, and NFO sidecar files (Kodi/Jellyfin) are also consulted when available.

### 🧠 Smart Fix
A single button that detects the dominant media type in a folder and applies the correct naming standard automatically.

- Configurable confidence threshold (default 40 %) — low-confidence folders trigger an alert instead of guessing
- **Long press** for a safe dry-run preview  
- Works with the same optional folder-structure creation as Quick Rename
- **Dry-run preview in the Property Inspector** — the last dry run is shown right in the Smart Fix settings panel, with an *Apply last preview* button that re-runs exactly the pattern and folder that was previewed

### 🧹 Sort Downloads
Sorts all loose files in a folder into categorised subfolders in one press:

| Subfolder | Extensions |
|---|---|
| Images | jpg jpeg png gif bmp heic heif webp tiff raw cr2 nef arw … |
| Videos | mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts … |
| Audio | mp3 flac aac ogg wav m4a wma opus aiff alac … |
| Documents | pdf doc docx xls xlsx ppt pptx txt md rtf odt csv … |
| eBooks | epub mobi azw azw3 fb2 lit … |
| Comics | cbz cbr cb7 cbt |
| Installers | exe msi dmg pkg deb rpm appimage snap flatpak iso … |
| Archives | zip rar 7z tar gz bz2 xz zst tar.gz tar.bz2 tar.xz … |
| ROMs | nes sfc gb gba n64 xci nsp wbfs gen sms gg pbp pce chd cue … |
| Subtitles | srt sub ass ssa vtt idx |
| Code | js ts py java c cpp h cs go rs rb php swift kt … |
| Other | everything else (optional) |

### 🩺 Collection Healer
Fix years of inconsistent naming across an entire collection. Detects missing metadata, junk scene tags, episode gaps, quality mismatches, and more — then batch-fixes everything.

- **Short press** → diagnose + heal the collection
- **Long press** → dry-run heal (preview in the log, nothing changed)
- Reports a collection **health score**; on Stream Deck+ the touchscreen browses individual issues
- Optional internet metadata enrichment (TMDB) for missing titles and years

### 🔍 Deep Scan
Recursively scans an entire library tree and reports a health score. Finds misnamed files across all subfolders and optionally auto-fixes them.

- **Short press** → scan + auto-fix
- **Long press** → scan only (report issues, change nothing)
- On Stream Deck+, rotate the dial to step through every issue found

### ↩️ Undo
Reverts the most recent MediaMaid operation — rename, Smart Fix, Sort Downloads, heal, or organize — restoring every file to its original name and location.

- Keeps a rolling history of up to **10 batches**, persisted across Stream Deck restarts
- The key title shows the live stack count and updates **immediately after every write action** (not just when Undo is pressed)
- After a successful undo, the key briefly shows which batch was reverted
- **Crash-safe journaling**: an undo snapshot is saved *before* the first file of a batch moves and updated after every operation — a crash mid-batch still leaves a fully revertible entry

### 📊 Library Stats
View library statistics: file counts by type, total size, and a naming health score. On Stream Deck+ the touchscreen shows a live dashboard you can cycle with the dial. Supports an auto-refresh interval (minimum 30 s).

### 📝 NFO Editor ★ *(premium feature)*
Create and edit NFO metadata files for Jellyfin/Kodi libraries directly from your Stream Deck. Auto-creates the right NFO type for a media file or folder (movie, TV show, artist, album), and on Stream Deck+ the dial cycles through NFO fields.

---

## Stream Deck+ support

Actions marked *Encoder* in the manifest work on Stream Deck+ dials with custom touchscreen layouts (`layouts/*.json`): live scan status, confidence bars, health scores, issue browsing, and stat dashboards. Keypad behaviour is unchanged on classic Stream Deck devices.

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) **20 or later**  
- [Stream Deck software](https://www.elgato.com/en/downloads) **6.8 or later**  
- macOS 10.15+ or Windows 10+

### Build from source

```bash
git clone https://github.com/Gameaday/Elagato-Media-Maid.git
cd Elagato-Media-Maid
npm install
npm run build
```

The compiled plugin bundle lands at `com.gameaday.mediamaid.sdPlugin/bin/plugin.js`.  
Copy the entire `com.gameaday.mediamaid.sdPlugin/` folder into the Stream Deck plugins directory:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/com.elgato.StreamDeck/Plugins/` |
| Windows | `%APPDATA%\Elgato\StreamDeck\Plugins\` |

You can also validate and package the plugin with the official Elgato CLI:

```bash
npm install -g @elgato/cli
streamdeck validate com.gameaday.mediamaid.sdPlugin
streamdeck pack com.gameaday.mediamaid.sdPlugin
```

### Development workflow

```bash
npm run build   # production build
npm test        # run tests
npm run lint    # lint TypeScript (src + __tests__)
```

CI runs lint, tests, a build, and `streamdeck validate` on every push. Icon placeholders are generated by `scripts/gen-placeholder-icons.mjs` when artwork files are missing (real action icons are tracked in [issue #18](https://github.com/Gameaday/Elagato-Media-Maid/issues/18)).

---

## Usage

### Adding buttons to your Stream Deck

1. Open the Stream Deck app and drag any **MediaMaid** action onto a key (or a Stream Deck+ dial).
2. In the Property Inspector panel (right side), configure the target folder path and any other options.
3. Press the key!

### Button actions

| Action | Settings |
|---|---|
| **Quick Rename** | Folder path, Naming standard, Create folder structure |
| **Smart Fix** | Folder path, Minimum confidence %, Create folder structure |
| **Sort Downloads** | Folder path, Create "Other" folder |
| **Collection Healer** | Collection path, Target standard, Internet lookup (TMDB), Create folder structure |
| **Deep Scan** | Library root, Auto-fix toggle |
| **Undo** | *(no settings — operates on the global undo stack)* |
| **Library Stats** | Library root, Auto-refresh interval |
| **NFO Editor ★** | Target media path, NFO type override, License key |

### Dry-run / preview

Any action that modifies files supports a **dry-run mode**: hold the button for more than 0.5 seconds. No files are moved or renamed; instead, a full summary of proposed changes is written to the log file.

For **Smart Fix**, the last dry run is also persisted to `~/.mediamaid/last-preview.json` and rendered in the Property Inspector, where you can apply it with one click.

**Log location:**  
`~/.mediamaid/mediamaid.log` (macOS/Linux)  
`%USERPROFILE%\.mediamaid\mediamaid.log` (Windows)

The Smart Fix Property Inspector also has an *Open log folder* button.

### Undo history

MediaMaid keeps a rolling history of up to **10 operations**. Each press of the Undo button reverts one complete batch (all files renamed by a single button press). The undo stack persists across Stream Deck restarts via `~/.mediamaid/undo-stack.json`, is journaled crash-safe during batches, and every Undo key title stays in sync with it live.

---

## Architecture

```
src/
  plugin.ts                  Entry point – registers all actions
  actions/
    quick-rename.ts          Quick Rename action
    smart-fix.ts             Smart Fix action (+ Property Inspector messaging)
    sort-downloads.ts        Sort Downloads action
    collection-healer.ts     Collection Healer action
    deep-scan.ts             Deep Scan action
    undo-action.ts           Undo action (live title sync)
    library-stats.ts         Library Stats action
    nfo-editor.ts            NFO Editor action (premium)
  lib/
    patterns.ts              Naming pattern definitions & formatter functions
    renamer.ts               Rename engine (filename parsing, deconfliction, dry-run, journaling)
    detector.ts              Heuristic media-type detector (single-pass scan)
    organizer.ts             Sort-by-type engine (Sort Downloads)
    healer.ts                Collection diagnosis & batch healing
    deep-scanner.ts          Recursive library scanner & health score
    library-stats.ts         Library statistics engine
    undo-manager.ts          Undo stack (journaling, apply, subscriptions)
    preview-store.ts          Last dry-run preview persistence
    nfo-parser.ts            NFO XML sidecar parser (Jellyfin/Kodi metadata)
    nfo-writer.ts            NFO creation/editing engine
    metadata-lookup.ts       Internet metadata enrichment (TMDB, MusicBrainz, Open Library)
    checksum.ts              Checksum utilities (verify / dedupe)
    compressor.ts            Archive & ROM compression helpers
    fs-utils.ts              Cross-device-safe move/copy primitives
    lock.ts                  Filesystem lock – serializes all mutating operations
    logger.ts                Batched, rotated operation log
    config.ts                Central extension registry & configuration
com.gameaday.mediamaid.sdPlugin/
  manifest.json              Stream Deck plugin manifest (SDK 2)
  layouts/                   Stream Deck+ touchscreen layouts (7)
  ui/                        Property Inspector pages (8) + sdpi-common.js + mediamaid.css
  imgs/                      Action & plugin icons
scripts/
  gen-placeholder-icons.mjs  Generates placeholder PNG icons for missing artwork
.github/workflows/ci.yml     CI: lint, test, build, streamdeck validate
__tests__/                   Jest unit tests
```

---

## Safety

- **Non-destructive by default** — all operations are renames/moves within the same filesystem; no files are deleted.
- **Dry-run mode** on every write action — long-press to preview before committing, and view the result in the Smart Fix Property Inspector.
- **Crash-safe undo** — undo snapshots are journaled before a batch starts and updated after every operation, so even a power loss mid-batch is fully revertible.
- **Undo** — reverse any batch operation with one press (up to 10 steps), persisted across restarts.
- **Serialized operations** — every mutating action runs under a filesystem lock, so two keys pressed at once can never interleave their changes.
- **Cross-device-safe moves** — moves that cross filesystems fall back to copy+verify instead of failing (or worse, silently losing data).
- **Deconfliction** — if two files would produce the same target name, a numeric suffix is appended to prevent collisions; existing destination files are never overwritten.
- **Logging** — every rename and move is logged with original and new paths; the log is batched (fast on huge folders) and rotated at 5 MB.

---

## Roadmap

- [x] Deep-scan mode for recursive library fixes — *shipped (Deep Scan action)*
- [x] Public API enrichment (TMDB, MusicBrainz, Open Library) for more accurate metadata — *shipped (Collection Healer lookups)*
- [ ] Custom pattern editor in the Property Inspector
- [ ] Paid tier: lossless reformatting, transcoding, and compression *(experimental transcode presets already in `config.ts`)*

---

## Contributing

Pull requests and issues are welcome. Please read the existing code style before contributing.

```bash
npm run lint    # must pass before PR
npm test        # all tests must pass
```

> **Note:** `PRELAUNCH_AUDIT.md` predates the current state of the repo — the CHANGELOG and CI workflow it marks as missing both exist now.

---

## License

MIT © Gameaday
