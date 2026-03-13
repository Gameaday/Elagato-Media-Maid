# MediaMaid – Stream Deck Plugin

> The Ultimate Tactile Media & File Archivist for Stream Deck

MediaMaid is a free, open-source [Elgato Stream Deck](https://www.elgato.com/en/stream-deck) plugin that turns your Stream Deck into a command centre for file organisation. Replace tedious manual renaming and expensive third-party subscriptions with one-touch automation — perfect for Jellyfin/Plex curators, photographers, music archivists, and data hoarders.

---

## Features

### 🎬 Quick Rename
Instantly rename all compatible files in a folder to a chosen standard:

| Standard | Example output |
|---|---|
| Jellyfin / Plex – TV Show | `Breaking Bad - S01E04 - Cancer Man.mkv` |
| Jellyfin / Plex – Movie | `Inception (2010).mkv` |
| Photography | `2024-06-15_Paris_003.jpg` |
| Music | `01 - Led Zeppelin - Stairway to Heaven.flac` |
| Books / eBooks | `Isaac Asimov - Foundation.epub` |
| Documents | `2024-06-15_Meeting Notes.pdf` |

- **Short press** → apply renames  
- **Long press (> 0.5 s)** → dry-run preview (logged, no files changed)  
- Optional: create folder structure alongside renaming (Season folders, Artist/Album folders, etc.)

Metadata is parsed from filenames using intelligent heuristics, and NFO sidecar files (Kodi/Jellyfin) are also consulted when available.

### 🧠 Smart Fix
A single button that detects the dominant media type in a folder and applies the correct naming standard automatically.

- Configurable confidence threshold (default 40 %) — low-confidence folders trigger an alert instead of guessing
- **Long press** for a safe dry-run preview  
- Works with the same optional folder-structure creation as Quick Rename

### ↩️ Undo
Reverts the most recent MediaMaid operation — rename, Smart Fix, or Nuke Downloads — restoring every file to its original name and location. The button title shows how many undo steps are available (up to 10).

### 💣 Nuke Downloads
Sorts all loose files in a folder into categorised subfolders in one press:

| Subfolder | Extensions |
|---|---|
| Images | jpg jpeg png gif bmp heic heif webp tiff raw cr2 nef arw |
| Videos | mp4 mkv avi mov wmv flv webm m4v mpg mpeg ts m2ts |
| Audio | mp3 flac aac ogg wav m4a wma opus aiff alac |
| Documents | pdf doc docx xls xlsx ppt pptx txt md rtf odt csv |
| eBooks | epub mobi azw azw3 cbz cbr fb2 lit lrf djvu |
| Installers | exe msi dmg pkg deb rpm appimage snap flatpak |
| Archives | zip rar 7z tar gz bz2 xz zst tar.gz tar.bz2 tar.xz |
| Code | js ts py java c cpp h cs go rs rb php swift kt |
| Other | everything else (optional) |

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later  
- [Stream Deck software](https://www.elgato.com/en/downloads) 6.4 or later

### Build from source

```bash
git clone https://github.com/Gameaday/Elgato-Media-Maid.git
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

### Development workflow

```bash
npm run build   # production build
npm test        # run tests
npm run lint    # lint TypeScript
```

---

## Usage

### Adding buttons to your Stream Deck

1. Open the Stream Deck app and drag any **MediaMaid** action onto a key.
2. In the Property Inspector panel (right side), configure the target folder path and any other options.
3. Press the key!

### Button actions

| Action | Settings |
|---|---|
| **Quick Rename** | Folder path, Naming standard, Create folder structure |
| **Smart Fix** | Folder path, Minimum confidence %, Create folder structure |
| **Undo** | *(no settings — operates on the global undo stack)* |
| **Nuke Downloads** | Folder path, Create "Other" folder |

### Dry-run / preview

Any action that modifies files supports a **dry-run mode**: hold the button for more than 0.5 seconds. No files are moved or renamed; instead, a full summary of proposed changes is written to the log file.

**Log location:**  
`~/.mediamaid/mediamaid.log` (macOS/Linux)  
`%USERPROFILE%\.mediamaid\mediamaid.log` (Windows)

### Undo history

MediaMaid keeps a rolling history of up to **10 operations**. Each press of the Undo button reverts one complete batch (all files renamed by a single button press). The undo stack persists across Stream Deck restarts via `~/.mediamaid/undo-stack.json`.

---

## Architecture

```
src/
  plugin.ts                  Entry point – registers all actions
  actions/
    quick-rename.ts          Quick Rename action
    smart-fix.ts             Smart Fix action
    undo-action.ts           Undo action
    nuke-downloads.ts        Nuke Downloads action
  lib/
    patterns.ts              Naming pattern definitions & formatter functions
    renamer.ts               Rename engine (filename parsing, deconfliction, dry-run)
    detector.ts              Heuristic media-type detector
    organizer.ts             Sort-by-type engine (Nuke Downloads)
    undo-manager.ts          Undo stack (push / pop / apply)
    nfo-parser.ts            NFO XML sidecar parser (Jellyfin/Kodi metadata)
    logger.ts                Append-only operation log
com.gameaday.mediamaid.sdPlugin/
  manifest.json              Stream Deck plugin manifest
  ui/
    quickrename.html         Property Inspector – Quick Rename
    smartfix.html            Property Inspector – Smart Fix
    nukedownloads.html       Property Inspector – Nuke Downloads
    undo.html                Property Inspector – Undo
```

---

## Safety

- **Non-destructive by default** — all operations are renames/moves within the same filesystem; no files are deleted.
- **Dry-run mode** on every write action — long-press to preview before committing.
- **Undo** — reverse any batch operation with one press (up to 10 steps).
- **Deconfliction** — if two files would produce the same target name, a numeric suffix is appended to prevent collisions.
- **Logging** — every rename and move is logged with original and new paths.

---

## Roadmap

- [ ] Public API enrichment (TVDB, MusicBrainz, Open Library) for more accurate metadata
- [ ] Deep-scan mode for recursive library fixes
- [ ] Custom pattern editor in the Property Inspector
- [ ] Paid tier: lossless reformatting, transcoding, and compression

---

## Contributing

Pull requests and issues are welcome. Please read the existing code style before contributing.

```bash
npm run lint    # must pass before PR
npm test        # all tests must pass
```

---

## License

MIT © Gameaday
