/**
 * SmartFix Action for MediaMaid.
 *
 * Analyzes the configured folder, detects the dominant media type,
 * then applies the appropriate naming pattern automatically.
 *
 * Short press  → auto-detect and apply rename
 * Long press   → dry-run preview (logged, no files changed)
 */

import streamDeck, {
  action,
  SingletonAction,
  type JsonValue,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type DidReceiveSettingsEvent
} from "@elgato/streamdeck";

import { detectMediaType } from "../lib/detector.js";
import { getPattern } from "../lib/patterns.js";
import { renameFolder, organizeWithFolderStructure } from "../lib/renamer.js";
import { getLogFilePath } from "../lib/logger.js";

export interface SmartFixSettings {
  [key: string]: JsonValue;
  /** Absolute path to the folder to analyze and fix */
  folderPath: string;
  /** Whether to also create folder structure (Season folders, Artist/Album, etc.) */
  createFolderStructure: boolean;
  /** Minimum confidence level (0–1) required before applying changes */
  minConfidence: number;
}

const LONG_PRESS_MS = 500;

@action({ UUID: "com.gameaday.mediamaid.smartfix" })
export class SmartFixAction extends SingletonAction<SmartFixSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  override async onKeyDown(ev: KeyDownEvent<SmartFixSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performSmartFix(ev, true).catch(err =>
        streamDeck.logger.error("SmartFix long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<SmartFixSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performSmartFix(ev, false);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<SmartFixSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (settings.minConfidence === undefined) {
      await ev.action.setSettings({
        folderPath: "",
        createFolderStructure: false,
        minConfidence: 0.4
      });
    }
    await ev.action.setTitle("Smart Fix");
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SmartFixSettings>): Promise<void> {
    await ev.action.setTitle("Smart Fix");
  }

  private async performSmartFix(
    ev: KeyDownEvent<SmartFixSettings> | KeyUpEvent<SmartFixSettings>,
    dryRun: boolean
  ): Promise<void> {
    const { settings } = ev.payload;

    if (!settings.folderPath) {
      await ev.action.showAlert();
      streamDeck.logger.warn("SmartFix: no folder path configured.");
      return;
    }

    try {
      await ev.action.setTitle(dryRun ? "Scanning…" : "Fixing…");

      const detection = detectMediaType(settings.folderPath);
      streamDeck.logger.info(
        `SmartFix detected: ${detection.mediaType} (confidence ${(detection.confidence * 100).toFixed(0)}%) – ${detection.reason}`
      );

      const minConf = settings.minConfidence ?? 0.4;

      if (detection.confidence < minConf) {
        await ev.action.showAlert();
        streamDeck.logger.warn(
          `SmartFix: confidence ${detection.confidence.toFixed(2)} below threshold ${minConf}. No changes made.`
        );
        await ev.action.setTitle("Low Conf.");
        setTimeout(() => ev.action.setTitle("Smart Fix"), 3000);
        return;
      }

      const pattern = getPattern(detection.mediaType);
      if (!pattern) {
        await ev.action.showAlert();
        streamDeck.logger.warn(`SmartFix: no pattern found for type "${detection.mediaType}"`);
        return;
      }

      const fn = settings.createFolderStructure
        ? organizeWithFolderStructure
        : renameFolder;

      const result = await fn(settings.folderPath, pattern, dryRun);

      const hasErrors = Object.keys(result.errors).length > 0;

      if (hasErrors) {
        await ev.action.showAlert();
        streamDeck.logger.error("SmartFix errors:", result.errors);
      } else {
        await ev.action.showOk();
      }

      const summary = dryRun
        ? `DRY RUN [${pattern.label}]: ${result.operations.length} file(s) would be renamed. Log: ${getLogFilePath()}`
        : `SmartFix [${pattern.label}]: Renamed ${result.renamed}, skipped ${result.skipped}.`;

      streamDeck.logger.info(summary);
    } catch (err) {
      await ev.action.showAlert();
      streamDeck.logger.error("SmartFix fatal error:", err);
    } finally {
      await ev.action.setTitle("Smart Fix");
    }
  }
}
