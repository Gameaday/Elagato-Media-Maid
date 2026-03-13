/**
 * NukeDownloads Action for MediaMaid.
 *
 * Sorts files in a configured folder into categorized subfolders
 * (Images, Videos, Audio, Documents, Installers, Archives, Code, Other).
 *
 * Keypad:
 *   Short press  → sort files
 *   Long press   → dry-run preview
 *
 * Encoder (Stream Deck+):
 *   Rotate       → browse category breakdown
 *   Push         → sort files
 *   Touch        → dry-run preview
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

import { sortFolder, DEFAULT_SORT_RULES } from "../lib/organizer.js";
import { getLogFilePath } from "../lib/logger.js";

export interface NukeDownloadsSettings {
  [key: string]: JsonValue;
  /** Absolute path to the folder to sort */
  folderPath: string;
  /** Whether to create an "Other" folder for unrecognized file types */
  createOtherFolder: boolean;
}

const LONG_PRESS_MS = 500;

/** Category names from sort rules for dial browsing */
const CATEGORIES = DEFAULT_SORT_RULES.map(r => r.folder).concat("Other");

@action({ UUID: "com.gameaday.mediamaid.nukedownloads" })
export class NukeDownloadsAction extends SingletonAction<NukeDownloadsSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private categoryIndex = new Map<string, number>();

  // ── Keypad handlers ──────────────────────────────────────────────

  override async onKeyDown(ev: KeyDownEvent<NukeDownloadsSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performSort(ev.action, ev.payload.settings, true).catch(err =>
        streamDeck.logger.error("NukeDownloads long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<NukeDownloadsSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performSort(ev.action, ev.payload.settings, false);
    }
  }

  // ── Encoder handlers (Stream Deck+) ──────────────────────────────

  override async onDialRotate(ev: DialRotateEvent<NukeDownloadsSettings>): Promise<void> {
    const context = ev.action.id;
    const current = this.categoryIndex.get(context) ?? 0;
    const delta = ev.payload.ticks > 0 ? 1 : -1;
    const next = (current + delta + CATEGORIES.length) % CATEGORIES.length;
    this.categoryIndex.set(context, next);

    await ev.action.setFeedback({
      "title": "Nuke Downloads",
      "category-name": CATEGORIES[next],
      "progress-bar": { value: Math.round(((next + 1) / CATEGORIES.length) * 100) },
      "status-text": `Category ${next + 1}/${CATEGORIES.length}`
    });
  }

  override async onDialDown(ev: DialDownEvent<NukeDownloadsSettings>): Promise<void> {
    await this.performSort(ev.action, ev.payload.settings, false);
  }

  override async onTouchTap(ev: TouchTapEvent<NukeDownloadsSettings>): Promise<void> {
    await this.performSort(ev.action, ev.payload.settings, true);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<NukeDownloadsSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (settings.createOtherFolder === undefined) {
      await ev.action.setSettings({
        folderPath: "",
        createOtherFolder: true
      });
    }
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Nuke\nDownloads");
    }

    if (ev.action.isDial()) {
      await ev.action.setFeedback({
        "title": "Nuke Downloads",
        "category-name": `${CATEGORIES.length} categories`,
        "progress-bar": { value: 0 },
        "status-text": settings.folderPath ? "Ready" : "No folder set"
      });
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NukeDownloadsSettings>): Promise<void> {
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Nuke\nDownloads");
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async performSort(
    actionObj: Action<NukeDownloadsSettings>,
    settings: NukeDownloadsSettings,
    dryRun: boolean
  ): Promise<void> {
    if (!settings.folderPath) {
      await actionObj.showAlert();
      streamDeck.logger.warn("NukeDownloads: no folder path configured.");
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(dryRun ? "Scanning…" : "Sorting…");
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run" : "Sorting",
          "category-name": "",
          "progress-bar": { value: 50 },
          "status-text": "Working…"
        });
      }

      const result = await sortFolder(
        settings.folderPath,
        DEFAULT_SORT_RULES,
        dryRun,
        settings.createOtherFolder ?? true
      );

      const hasErrors = Object.keys(result.errors).length > 0;

      if (hasErrors) {
        await actionObj.showAlert();
        streamDeck.logger.error("NukeDownloads errors:", result.errors);
      } else if (actionObj.isKey()) {
        await actionObj.showOk();
      }

      const categories = Object.entries(result.moved)
        .map(([folder, files]) => `${folder}: ${files.length}`)
        .join(", ");

      if (dryRun) {
        streamDeck.logger.info(
          `DRY RUN NukeDownloads: ${result.totalMoved} file(s) would be moved. [${categories}] Log: ${getLogFilePath()}`
        );
      } else {
        streamDeck.logger.info(
          `NukeDownloads: moved ${result.totalMoved} file(s). [${categories}]`
        );
      }

      if (actionObj.isDial()) {
        const topCategory = Object.entries(result.moved)
          .sort((a, b) => b[1].length - a[1].length)[0];
        await actionObj.setFeedback({
          "title": "Nuke Downloads",
          "category-name": topCategory ? `${topCategory[0]}: ${topCategory[1].length}` : "No files",
          "progress-bar": { value: 100 },
          "status-text": dryRun
            ? `Preview: ${result.totalMoved} file(s)`
            : `Done: ${result.totalMoved} sorted`
        });
      }
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("NukeDownloads fatal error:", err);
    } finally {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Nuke\nDownloads");
      }
    }
  }
}
