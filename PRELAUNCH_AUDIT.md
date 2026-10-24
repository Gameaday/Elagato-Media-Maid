# Pre-Launch Audit — MediaMaid (2026-10-24)

> Companion to [ROADMAP](./ROADMAP.md). Phase 2 product (Feb–Apr 2027); this audit is written now so Phase 2 starts from a checklist, not a blank page.

## Verdict summary

| Area | Status | One-liner |
|---|---|---|
| Core focus | ✅ strong | Rename/organize media in one press — one job, done many ways |
| Scope sprawl | ⚠️ one risk | Transcode pipeline (Pro, month 3) is a second product in disguise |
| Tier design | ✅ sound | Plugin = funnel (free), app = product (one-time) |
| Polish | ⚠️ gaps | No CHANGELOG, no CI, marketplace presence unverified |
| Readiness | ✅ fine | Phase 2 hasn't started; these are prep items |

## Core promise & scope check

The promise: *one-touch media organization for people who curate.* Quick Rename, Smart Fix, Undo, Nuke Downloads all serve it — the multiple naming standards are one feature, not sprawl. Focus discipline to keep: **a new naming standard is a config row; a new *capability* (transcode, scrape, dedupe) is sprawl and needs the gate.**

**Sprawl risk — transcode pipeline.** ROADMAP puts a Pro transcode/reformat pipeline in month 3. Transcoding is a support-ticket machine (codec quirks, GPU drivers, broken outputs) and stretches the ≤ 2 hrs/week budget. Recommendation: **defer transcode past 1.0.** Pro = watch folders + undo journal at launch; transcode is a paid 1.x upgrade if users ask for it. It also keeps the message clean: MediaMaid *organizes*; it does not convert.

## Tier design review

Plugin free-forever as the funnel is exactly right. App Free/Pro split is clean. Two refinements:
- **Plugin v2 should ship the app teaser**: a "MediaMaid desktop app" property inspector link on the plugin itself. Zero cost, converts the existing funnel.
- **Keep Pro features offline-verifiable** (watch folders, undo journal) so license validation never phones home — consistent with the no-tracking stance.

## Professionalism & polish gaps

| Gap | Priority | Owner |
|---|---|---|
| CHANGELOG.md (plugin has been live at v1.0.0 with no release history visible) | high — start now | AI |
| CI workflow: lint + jest + build on push, artifact on tag | high | AI |
| Stream Deck Marketplace presence: verify whether the plugin is marketplace-listed; if not, that is Phase 2's first distribution task (Elgato review required) | high | Carl (account) + AI (prep) |
| Plugin manifest metadata: author URL, support URL, source URL — professionalism signals Elgato reviewers check | medium | AI |
| Undo-journal docs (what Undo covers, its limits — sets expectations pre-review) | medium | AI (Phase 2) |
| Versioning policy: bump package.json + manifest together, tag releases | medium | AI |

## "As-is" vs 1.0

- **As-is:** plugin v1.0.0 works and is free — its job right now is to accumulate an install base and issue history for Phase 2.
- **MediaMaid 1.0 (Apr 2027 bar):** standalone desktop app (rename engine extracted), watch folders, full undo journal, one-time $19 founding pricing, marketplace + Reddit + cross-promo launch.

## Ordered steps before Phase 2 starts

1. CHANGELOG + CI (this month, zero-risk).
2. Decide marketplace strategy (list plugin officially, or GitHub-only funnel).
3. At phase start: extract rename engine → desktop app skeleton.
4. Cut list for 1.0 written before any code: rename + watch folders + undo. Nothing else.
