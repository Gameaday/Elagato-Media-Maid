/**
 * NukeDownloads Action for MediaMaid.
 *
 * Sorts files in a configured folder into categorized subfolders
 * (Images, Videos, Audio, Documents, Installers, Archives, Code, Other).
 *
 * Short press  → sort files
 * Long press   → dry-run preview
 */

import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type DidReceiveSettingsEvent
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

@action({ UUID: "com.gameaday.mediamaid.nukedownloads" })
export class NukeDownloadsAction extends SingletonAction<NukeDownloadsSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  override async onKeyDown(ev: KeyDownEvent<NukeDownloadsSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performSort(ev, true).catch(err =>
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
      await this.performSort(ev, false);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<NukeDownloadsSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (settings.createOtherFolder === undefined) {
      await ev.action.setSettings({
        folderPath: "",
        createOtherFolder: true
      });
    }
    await ev.action.setTitle("Nuke\nDownloads");
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NukeDownloadsSettings>): Promise<void> {
    await ev.action.setTitle("Nuke\nDownloads");
  }

  private async performSort(
    ev: KeyDownEvent<NukeDownloadsSettings> | KeyUpEvent<NukeDownloadsSettings>,
    dryRun: boolean
  ): Promise<void> {
    const { settings } = ev.payload;

    if (!settings.folderPath) {
      await ev.action.showAlert();
      streamDeck.logger.warn("NukeDownloads: no folder path configured.");
      return;
    }

    try {
      await ev.action.setTitle(dryRun ? "Scanning…" : "Sorting…");

      const result = await sortFolder(
        settings.folderPath,
        DEFAULT_SORT_RULES,
        dryRun,
        settings.createOtherFolder ?? true
      );

      const hasErrors = Object.keys(result.errors).length > 0;

      if (hasErrors) {
        await ev.action.showAlert();
        streamDeck.logger.error("NukeDownloads errors:", result.errors);
      } else {
        await ev.action.showOk();
      }

      if (dryRun) {
        const categories = Object.entries(result.moved)
          .map(([folder, files]) => `${folder}: ${files.length}`)
          .join(", ");
        streamDeck.logger.info(
          `DRY RUN NukeDownloads: ${result.totalMoved} file(s) would be moved. [${categories}] Log: ${getLogFilePath()}`
        );
      } else {
        const categories = Object.entries(result.moved)
          .map(([folder, files]) => `${folder}: ${files.length}`)
          .join(", ");
        streamDeck.logger.info(
          `NukeDownloads: moved ${result.totalMoved} file(s). [${categories}]`
        );
      }
    } catch (err) {
      await ev.action.showAlert();
      streamDeck.logger.error("NukeDownloads fatal error:", err);
    } finally {
      await ev.action.setTitle("Nuke\nDownloads");
    }
  }
}
