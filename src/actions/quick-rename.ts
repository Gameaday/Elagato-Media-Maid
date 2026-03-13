/**
 * QuickRename Action for MediaMaid.
 *
 * Renames files in a configured folder to a chosen naming standard
 * (Jellyfin TV, Jellyfin Movie, Photography, Music, Books, or Documents).
 *
 * Short press  → apply rename
 * Long press   → dry-run preview (logged, no files changed)
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

import { MediaType, getPattern } from "../lib/patterns.js";
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

@action({ UUID: "com.gameaday.mediamaid.quickrename" })
export class QuickRenameAction extends SingletonAction<QuickRenameSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  override async onKeyDown(ev: KeyDownEvent<QuickRenameSettings>): Promise<void> {
    const context = ev.action.id;
    // Start a timer to detect long-press
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performRename(ev, true).catch(err =>
        streamDeck.logger.error("QuickRename long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<QuickRenameSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      // Short press – cancel long-press timer and run normally
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performRename(ev, false);
    }
    // If timer is gone, long-press already fired
  }

  override async onWillAppear(ev: WillAppearEvent<QuickRenameSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (!settings.mediaType) {
      // Set defaults for new instances
      await ev.action.setSettings({
        folderPath: "",
        mediaType: MediaType.JELLYFIN_TV,
        createFolderStructure: false
      });
    }
    await this.updateTitle(ev.action, settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<QuickRenameSettings>): Promise<void> {
    await this.updateTitle(ev.action, ev.payload.settings);
  }

  private async updateTitle(
    action: { setTitle(title: string): Promise<void> },
    settings: QuickRenameSettings
  ): Promise<void> {
    const pattern = getPattern(settings.mediaType);
    const label = pattern?.label.split("–")[1]?.trim() ?? "Quick Rename";
    await action.setTitle(label);
  }

  private async performRename(
    ev: KeyDownEvent<QuickRenameSettings> | KeyUpEvent<QuickRenameSettings>,
    dryRun: boolean
  ): Promise<void> {
    const { settings } = ev.payload;

    if (!settings.folderPath) {
      await ev.action.showAlert();
      streamDeck.logger.warn("QuickRename: no folder path configured.");
      return;
    }

    const pattern = getPattern(settings.mediaType);
    if (!pattern) {
      await ev.action.showAlert();
      streamDeck.logger.error(`QuickRename: unknown media type "${settings.mediaType}"`);
      return;
    }

    try {
      await ev.action.setTitle(dryRun ? "Dry Run…" : "Renaming…");

      const fn = settings.createFolderStructure
        ? organizeWithFolderStructure
        : renameFolder;

      const result = await fn(settings.folderPath, pattern, dryRun);

      const hasErrors = Object.keys(result.errors).length > 0;

      if (hasErrors) {
        await ev.action.showAlert();
        streamDeck.logger.error("QuickRename errors:", result.errors);
      } else {
        await ev.action.showOk();
      }

      const summary = dryRun
        ? `DRY RUN: ${result.operations.length} file(s) would be renamed. See log: ${getLogFilePath()}`
        : `Renamed ${result.renamed} file(s), skipped ${result.skipped}.`;

      streamDeck.logger.info(`QuickRename [${pattern.label}]: ${summary}`);
    } catch (err) {
      await ev.action.showAlert();
      streamDeck.logger.error("QuickRename fatal error:", err);
    } finally {
      await this.updateTitle(ev.action, settings);
    }
  }
}
