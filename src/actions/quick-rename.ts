/**
 * QuickRename Action for MediaMaid.
 *
 * Renames files in a configured folder to a chosen naming standard
 * (Jellyfin TV, Jellyfin Movie, Photography, Music, Books, or Documents).
 *
 * Keypad:
 *   Short press  → apply rename
 *   Long press   → dry-run preview (logged, no files changed)
 *
 * Encoder (Stream Deck+):
 *   Rotate       → cycle through naming patterns
 *   Push         → apply rename
 *   Touch        → dry-run preview
 *   Long Touch   → reserved
 */

import streamDeck, {
  action,
  SingletonAction,
  type Action,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type DidReceiveSettingsEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type TouchTapEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { MediaType, getPattern, ALL_PATTERNS } from "../lib/patterns.js";
import { renameFolder, organizeWithFolderStructure } from "../lib/renamer.js";
import { getLogFilePath } from "../lib/logger.js";

export interface QuickRenameSettings {
  [key: string]: JsonValue;
  /** Absolute path to the folder to operate on */
  folderPath: string;
  /** MediaType to apply */
  mediaType: MediaType;
  /** Whether to also create folder structure (e.g., Season folders) */
  createFolderStructure: boolean;
}

const LONG_PRESS_MS = 500;

/** Ordered list of media types for dial cycling */
const PATTERN_CYCLE = ALL_PATTERNS.map(p => p.mediaType);

@action({ UUID: "com.gameaday.mediamaid.quickrename" })
export class QuickRenameAction extends SingletonAction<QuickRenameSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Keypad handlers ──────────────────────────────────────────────

  override async onKeyDown(ev: KeyDownEvent<QuickRenameSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performRename(ev.action, ev.payload.settings, true).catch(err =>
        streamDeck.logger.error("QuickRename long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<QuickRenameSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performRename(ev.action, ev.payload.settings, false);
    }
  }

  // ── Encoder handlers (Stream Deck+) ──────────────────────────────

  override async onDialRotate(ev: DialRotateEvent<QuickRenameSettings>): Promise<void> {
    const { settings } = ev.payload;
    const currentIdx = PATTERN_CYCLE.indexOf(settings.mediaType);
    const delta = ev.payload.ticks > 0 ? 1 : -1;
    const nextIdx = (currentIdx + delta + PATTERN_CYCLE.length) % PATTERN_CYCLE.length;
    const nextType = PATTERN_CYCLE[nextIdx];

    await ev.action.setSettings({ ...settings, mediaType: nextType });

    const pattern = getPattern(nextType);
    const label = pattern?.label ?? "Unknown";

    await ev.action.setFeedback({
      "title": "Quick Rename",
      "pattern-name": label,
      "status-bar": { value: Math.round(((nextIdx + 1) / PATTERN_CYCLE.length) * 100) },
      "status-text": `Pattern ${nextIdx + 1}/${PATTERN_CYCLE.length}`
    });
    await ev.action.setTitle(label.split("–")[1]?.trim() ?? "Rename");
  }

  override async onDialDown(ev: DialDownEvent<QuickRenameSettings>): Promise<void> {
    await this.performRename(ev.action, ev.payload.settings, false);
  }

  override async onTouchTap(ev: TouchTapEvent<QuickRenameSettings>): Promise<void> {
    if (ev.payload.hold) return; // ignore long-touch for now
    await this.performRename(ev.action, ev.payload.settings, true);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<QuickRenameSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (!settings.mediaType) {
      await ev.action.setSettings({
        folderPath: "",
        mediaType: MediaType.JELLYFIN_TV,
        createFolderStructure: false
      });
    }
    await this.updateDisplay(ev.action, settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<QuickRenameSettings>): Promise<void> {
    await this.updateDisplay(ev.action, ev.payload.settings);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async updateDisplay(
    actionObj: Action<QuickRenameSettings>,
    settings: QuickRenameSettings
  ): Promise<void> {
    const pattern = getPattern(settings.mediaType);
    const label = pattern?.label.split("–")[1]?.trim() ?? "Quick Rename";
    if (actionObj.isKey() || actionObj.isDial()) {
      await actionObj.setTitle(label);
    }

    // Update touchscreen if available
    if (actionObj.isDial()) {
      await actionObj.setFeedback({
        "title": "Quick Rename",
        "pattern-name": pattern?.label ?? "Not Set",
        "status-bar": { value: 0 },
        "status-text": settings.folderPath ? "Ready" : "No folder set"
      });
    }
  }

  private async performRename(
    actionObj: Action<QuickRenameSettings>,
    settings: QuickRenameSettings,
    dryRun: boolean
  ): Promise<void> {
    if (!settings.folderPath) {
      await actionObj.showAlert();
      streamDeck.logger.warn("QuickRename: no folder path configured.");
      return;
    }

    const pattern = getPattern(settings.mediaType);
    if (!pattern) {
      await actionObj.showAlert();
      streamDeck.logger.error(`QuickRename: unknown media type "${settings.mediaType}"`);
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(dryRun ? "Dry Run…" : "Renaming…");
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run" : "Renaming",
          "pattern-name": pattern.label,
          "status-bar": { value: 50 },
          "status-text": "Working…"
        });
      }

      const fn = settings.createFolderStructure
        ? organizeWithFolderStructure
        : renameFolder;

      const result = await fn(settings.folderPath, pattern, dryRun);
      const hasErrors = Object.keys(result.errors).length > 0;

      if (hasErrors) {
        await actionObj.showAlert();
        streamDeck.logger.error("QuickRename errors:", result.errors);
      } else if (actionObj.isKey()) {
        await actionObj.showOk();
      }

      const summary = dryRun
        ? `DRY RUN: ${result.operations.length} file(s) would be renamed. See log: ${getLogFilePath()}`
        : `Renamed ${result.renamed} file(s), skipped ${result.skipped}.`;

      streamDeck.logger.info(`QuickRename [${pattern.label}]: ${summary}`);

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Quick Rename",
          "pattern-name": pattern.label,
          "status-bar": { value: 100 },
          "status-text": dryRun
            ? `Preview: ${result.operations.length} file(s)`
            : `Done: ${result.renamed} renamed`
        });
      }
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("QuickRename fatal error:", err);
    } finally {
      const resetLabel = pattern.label.split("–")[1]?.trim() ?? "Quick Rename";
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(resetLabel);
      }
    }
  }
}
