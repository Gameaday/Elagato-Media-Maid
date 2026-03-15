/**
 * SmartFix Action for MediaMaid.
 *
 * Analyzes the configured folder, detects the dominant media type,
 * then applies the appropriate naming pattern automatically.
 *
 * Keypad:
 *   Short press  → auto-detect and apply rename
 *   Long press   → dry-run preview (logged, no files changed)
 *
 * Encoder (Stream Deck+):
 *   Rotate       → adjust confidence threshold (±5%)
 *   Push         → auto-detect and apply rename
 *   Touch        → dry-run preview
 *   Long Touch   → rescan folder and show detection result
 */

import streamDeck, {
  action,
  SingletonAction,
  type Action,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DidReceiveSettingsEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type TouchTapEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { detectMediaType } from "../lib/detector.js";
import { getPattern } from "../lib/patterns.js";
import { renameFolder, organizeWithFolderStructure } from "../lib/renamer.js";
import { getLogFilePath } from "../lib/logger.js";
import { LONG_PRESS_MS, STATUS_RESET_MS, DEFAULT_MIN_CONFIDENCE } from "../lib/config.js";

export interface SmartFixSettings {
  [key: string]: JsonValue;
  /** Absolute path to the folder to analyze and fix */
  folderPath: string;
  /** Whether to also create folder structure (Season folders, Artist/Album, etc.) */
  createFolderStructure: boolean;
  /** Minimum confidence level (0–1) required before applying changes */
  minConfidence: number;
}

@action({ UUID: "com.gameaday.mediamaid.smartfix" })
export class SmartFixAction extends SingletonAction<SmartFixSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Keypad handlers ──────────────────────────────────────────────

  override async onKeyDown(ev: KeyDownEvent<SmartFixSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performSmartFix(ev.action, ev.payload.settings, true).catch(err =>
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
      await this.performSmartFix(ev.action, ev.payload.settings, false);
    }
  }

  // ── Encoder handlers (Stream Deck+) ──────────────────────────────

  override async onDialRotate(ev: DialRotateEvent<SmartFixSettings>): Promise<void> {
    const { settings } = ev.payload;
    const delta = ev.payload.ticks > 0 ? 0.05 : -0.05;
    const newConf = Math.max(0.1, Math.min(1.0, (settings.minConfidence ?? 0.4) + delta));
    const rounded = Math.round(newConf * 100) / 100;

    await ev.action.setSettings({ ...settings, minConfidence: rounded });

    await ev.action.setFeedback({
      "title": "Smart Fix",
      "detected-type": `Threshold: ${Math.round(rounded * 100)}%`,
      "confidence-bar": { value: Math.round(rounded * 100) },
      "confidence-text": rounded <= 0.3 ? "Low – more matches" : rounded >= 0.7 ? "High – strict" : "Balanced"
    });
  }

  override async onDialDown(ev: DialDownEvent<SmartFixSettings>): Promise<void> {
    await this.performSmartFix(ev.action, ev.payload.settings, false);
  }

  override async onTouchTap(ev: TouchTapEvent<SmartFixSettings>): Promise<void> {
    if (ev.payload.hold) {
      // Long touch – rescan and show detection without fixing
      await this.performRescan(ev.action, ev.payload.settings);
    } else {
      // Short touch – dry-run preview
      await this.performSmartFix(ev.action, ev.payload.settings, true);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<SmartFixSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (settings.minConfidence === undefined) {
      await ev.action.setSettings({
        folderPath: "",
        createFolderStructure: false,
        minConfidence: DEFAULT_MIN_CONFIDENCE
      });
    }
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Smart Fix");
    }

    if (ev.action.isDial()) {
      await ev.action.setFeedback({
        "title": "Smart Fix",
        "detected-type": "Not scanned",
        "confidence-bar": { value: 0 },
        "confidence-text": settings.folderPath ? "Ready to scan" : "Set folder path"
      });
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SmartFixSettings>): Promise<void> {
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Smart Fix");
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<SmartFixSettings>): Promise<void> {
    const timer = this.pressTimers.get(ev.action.id);
    if (timer !== undefined) clearTimeout(timer);
    this.pressTimers.delete(ev.action.id);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async performRescan(
    actionObj: Action<SmartFixSettings>,
    settings: SmartFixSettings
  ): Promise<void> {
    if (!settings.folderPath) {
      await actionObj.showAlert();
      return;
    }

    try {
      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Scanning…",
          "detected-type": "",
          "confidence-bar": { value: 50 },
          "confidence-text": "Analyzing folder…"
        });
      }

      const detection = await detectMediaType(settings.folderPath);
      const pattern = getPattern(detection.mediaType);

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Smart Fix",
          "detected-type": pattern?.label ?? detection.mediaType,
          "confidence-bar": { value: Math.round(detection.confidence * 100) },
          "confidence-text": `${Math.round(detection.confidence * 100)}% – ${detection.reason}`
        });
      }

      streamDeck.logger.info(`SmartFix rescan: ${detection.mediaType} (${Math.round(detection.confidence * 100)}%)`);
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("SmartFix rescan error:", err);
    }
  }

  private async performSmartFix(
    actionObj: Action<SmartFixSettings>,
    settings: SmartFixSettings,
    dryRun: boolean
  ): Promise<void> {
    if (!settings.folderPath) {
      await actionObj.showAlert();
      streamDeck.logger.warn("SmartFix: no folder path configured.");
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(dryRun ? "Scanning…" : "Fixing…");
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run" : "Fixing",
          "detected-type": "Detecting…",
          "confidence-bar": { value: 25 },
          "confidence-text": "Analyzing…"
        });
      }

      const detection = await detectMediaType(settings.folderPath);
      streamDeck.logger.info(
        `SmartFix detected: ${detection.mediaType} (confidence ${(detection.confidence * 100).toFixed(0)}%) – ${detection.reason}`
      );

      const minConf = settings.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

      if (detection.confidence < minConf) {
        await actionObj.showAlert();
        streamDeck.logger.warn(
          `SmartFix: confidence ${detection.confidence.toFixed(2)} below threshold ${minConf}. No changes made.`
        );
        if (actionObj.isKey() || actionObj.isDial()) {
          await actionObj.setTitle("Low Conf.");
        }

        if (actionObj.isDial()) {
          await actionObj.setFeedback({
            "title": "Low Confidence",
            "detected-type": detection.mediaType.replace(/_/g, " "),
            "confidence-bar": { value: Math.round(detection.confidence * 100) },
            "confidence-text": `${Math.round(detection.confidence * 100)}% < ${Math.round(minConf * 100)}% threshold`
          });
        }

        setTimeout(() => {
          if (actionObj.isKey() || actionObj.isDial()) {
            actionObj.setTitle("Smart Fix");
          }
        }, STATUS_RESET_MS);
        return;
      }

      const pattern = getPattern(detection.mediaType);
      if (!pattern) {
        await actionObj.showAlert();
        streamDeck.logger.warn(`SmartFix: no pattern found for type "${detection.mediaType}"`);
        return;
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run" : "Fixing",
          "detected-type": pattern.label,
          "confidence-bar": { value: Math.round(detection.confidence * 100) },
          "confidence-text": "Applying…"
        });
      }

      const fn = settings.createFolderStructure
        ? organizeWithFolderStructure
        : renameFolder;

      const result = await fn(settings.folderPath, pattern, dryRun);
      const hasErrors = Object.keys(result.errors).length > 0;

      if (hasErrors) {
        await actionObj.showAlert();
        streamDeck.logger.error("SmartFix errors:", result.errors);
      } else if (actionObj.isKey()) {
        await actionObj.showOk();
      }

      const summary = dryRun
        ? `DRY RUN [${pattern.label}]: ${result.operations.length} file(s) would be renamed. Log: ${getLogFilePath()}`
        : `SmartFix [${pattern.label}]: Renamed ${result.renamed}, skipped ${result.skipped}.`;

      streamDeck.logger.info(summary);

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Smart Fix",
          "detected-type": pattern.label,
          "confidence-bar": { value: 100 },
          "confidence-text": dryRun
            ? `Preview: ${result.operations.length} file(s)`
            : `Done: ${result.renamed} renamed`
        });
      }
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("SmartFix fatal error:", err);
    } finally {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Smart Fix");
      }
    }
  }
}
