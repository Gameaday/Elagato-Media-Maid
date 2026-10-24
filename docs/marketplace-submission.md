# Marketplace Submission Checklist — MediaMaid

> Goal: MediaMaid published on the Elgato Marketplace — one product on the Elgato store for the year. Verify each item before submitting via [Maker Console](https://developer.elgato.com/documentation/stream-deck/maker-console/). Requirements sourced from [Elgato plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/).

## Manifest (fixed 2026-10-24)

- [x] Plugin UUID is reverse-DNS with author + product: `com.gameaday.mediamaid`
- [x] Action UUIDs prefixed with the plugin UUID
- [x] Author field set (`GameADay`) — must match the Marketplace organization name you register
- [x] Name (`MediaMaid`) is descriptive and concise
- [x] Node.js debug flag disabled (must be off for distribution)
- [x] OS + minimum Stream Deck software versions declared
- [ ] Confirm "MediaMaid" is not already taken on Marketplace (check at submission)

## Images (verify against guidelines before submitting)

| Image | Required size | Style rule |
|---|---|---|
| Plugin icon (`imgs/plugin/icon`) | 256×256 PNG (+ 512×512 hi-DPI) | accurately portrays the plugin |
| Category icon (`imgs/plugin/category`) | 28×28 (+ 56×56 hi-DPI) SVG or PNG | monochrome, transparent background, white stroke |
| Action icons (`imgs/actions/*/icon`) | 20×20 (+ 40×40 hi-DPI) SVG or PNG | monochrome, transparent background, white stroke |
| Key icons (state images) | 72×72 (+ 144×144 hi-DPI) SVG/PNG | — |

## Pre-submission steps

1. Register a Maker account in Maker Console; set the organization name to match `Author` (`GameADay`).
2. `npm install -g @streamdeck/cli` then `npm run validate` — manifest schema and file structure must pass.
3. `npm run pack` to produce the `.streamDeckPlugin` file.
4. Install the packaged file locally and smoke-test all 8 actions (including a dry-run and an undo).
5. Optional but recommended: share in the Marketplace Maker Discord for beta feedback before submitting.
6. Submit in Maker Console; fill support URL (GitHub issues) and source URL fields.

## Notes

- Description text and tooltips already follow the guidelines (concise, descriptive, no trademarks of Jellyfin/Plex beyond nominative use).
- Keep the repo README as the canonical feature doc; the listing description should stay short.
- After publication, never change the plugin or action UUIDs — hide legacy actions instead.
