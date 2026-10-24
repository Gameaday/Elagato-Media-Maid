# Changelog

All notable changes to MediaMaid will be documented in this file.

## [Unreleased]

### Changed

- Renamed "Nuke Downloads" action to "Sort Downloads" ahead of Marketplace submission (#6).
  - Action UUID: `com.gameaday.mediamaid.nukedownloads` -> `com.gameaday.mediamaid.sortdownloads` (pre-release, no installed users affected).
  - PI page: `ui/nukedownloads.html` -> `ui/sortdownloads.html`; layout: `layouts/nuke-status.json` -> `layouts/sort-status.json` (layout id `com.gameaday.mediamaid.layout.sort-status`).
  - Internal renames: `NukeDownloadsAction` -> `SortDownloadsAction`, `NukeDownloadsSettings` -> `SortDownloadsSettings`.
  - No logic changes.

## [1.1.0] — 2026-10-24

### Fixed
- Disabled the Node.js debug flag in the plugin manifest — remote debugging must be off for Marketplace distribution.
- Aligned version numbers: `package.json` now matches the plugin manifest (1.1.0).

### Added
- `validate` and `pack` npm scripts (Stream Deck CLI) for Marketplace packaging.
- CI workflow: lint, tests, and a production build on every push and pull request.
- Marketplace submission checklist (docs/marketplace-submission.md).

## [1.0.0] — initial release

- Smart Fix, Quick Rename, Nuke Downloads, Collection Healer, Deep Scan, Undo, Library Stats, and NFO Editor actions.
- Jellyfin/Plex, photography, music, books, comics, ROMs, and documents naming standards.
- Stream Deck+ encoder and touchscreen support with live status layouts.

