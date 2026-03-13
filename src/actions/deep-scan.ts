/**
 * DeepScan Action for MediaMaid.
 *
 * Recursively scans a library root for naming inconsistencies,
 * reports a health score, and optionally auto-fixes issues.
 *
 * Keypad:
 *   Short press  → scan and auto-fix
 *   Long press   → scan only (dry-run, report issues)
 *
 * Encoder (Stream Deck+):
 *   Rotate       → browse scan results
 *   Push         → start scan + auto-fix
 *   Touch        → start scan (report only)
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

import { deepScan, type DeepScanResult } from "../lib/deep-scanner.js";

export interface DeepScanSettings {
  [key: string]: JsonValue;
  /** Root directory to scan */
  libraryRoot: string;
  /** Whether to automatically fix issues */
  autoFix: boolean;
}

const LONG_PRESS_MS = 500;

@action({ UUID: "com.gameaday.mediamaid.deepscan" })
export class DeepScanAction extends SingletonAction<DeepScanSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastResults = new Map<string, DeepScanResult>();
  private issueIndex = new Map<string, number>();

  // ── Keypad handlers ──────────────────────────────────────────────

  override async onKeyDown(ev: KeyDownEvent<DeepScanSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performScan(ev.action, ev.payload.settings, false).catch(err =>
        streamDeck.logger.error("DeepScan long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<DeepScanSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performScan(ev.action, ev.payload.settings, true);
    }
  }

  // ── Encoder handlers (Stream Deck+) ──────────────────────────────

  override async onDialRotate(ev: DialRotateEvent<DeepScanSettings>): Promise<void> {
    const context = ev.action.id;
    const results = this.lastResults.get(context);
    if (!results || results.issues.length === 0) {
      await ev.action.setFeedback({
        "title": "Deep Scan",
        "scan-info": "No results yet",
        "scan-bar": { value: 0 },
        "status-text": "Press to scan"
      });
      return;
    }

    const current = this.issueIndex.get(context) ?? 0;
    const delta = ev.payload.ticks > 0 ? 1 : -1;
    const next = (current + delta + results.issues.length) % results.issues.length;
    this.issueIndex.set(context, next);

    const issue = results.issues[next];
    await ev.action.setFeedback({
      "title": `Issue ${next + 1}/${results.issues.length}`,
      "scan-info": issue.currentName,
      "scan-bar": { value: Math.round(results.healthScore) },
      "status-text": `→ ${issue.suggestedName}`
    });
  }

  override async onDialDown(ev: DialDownEvent<DeepScanSettings>): Promise<void> {
    await this.performScan(ev.action, ev.payload.settings, true);
  }

  override async onTouchTap(ev: TouchTapEvent<DeepScanSettings>): Promise<void> {
    await this.performScan(ev.action, ev.payload.settings, false);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<DeepScanSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (!settings.libraryRoot) {
      await ev.action.setSettings({
        libraryRoot: "",
        autoFix: false
      });
    }
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Deep\nScan");
    }

    if (ev.action.isDial()) {
      await ev.action.setFeedback({
        "title": "Deep Scan",
        "scan-info": "Not scanned",
        "scan-bar": { value: 0 },
        "status-text": settings.libraryRoot ? "Ready" : "Set library root"
      });
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<DeepScanSettings>): Promise<void> {
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Deep\nScan");
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async performScan(
    actionObj: Action<DeepScanSettings>,
    settings: DeepScanSettings,
    autoFix: boolean
  ): Promise<void> {
    if (!settings.libraryRoot) {
      await actionObj.showAlert();
      streamDeck.logger.warn("DeepScan: no library root configured.");
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Scanning…");
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Scanning…",
          "scan-info": "Analyzing library",
          "scan-bar": { value: 25 },
          "status-text": "Please wait…"
        });
      }

      const fix = autoFix && (settings.autoFix !== false);
      const result = await deepScan(settings.libraryRoot, fix, !fix);

      // Store results for browsing via dial
      this.lastResults.set(actionObj.id, result);
      this.issueIndex.set(actionObj.id, 0);

      const hasErrors = Object.keys(result.errors).length > 0;
      if (hasErrors) {
        await actionObj.showAlert();
        streamDeck.logger.error("DeepScan errors:", result.errors);
      } else if (actionObj.isKey()) {
        await actionObj.showOk();
      }

      streamDeck.logger.info(
        `DeepScan: ${result.directoriesScanned} dirs, ${result.filesExamined} files, ` +
        `${result.issues.length} issues, ${result.fixed} fixed, health ${result.healthScore}%`
      );

      // Update title with health score
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(`${result.healthScore}%\nHealth`);
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": `Health: ${result.healthScore}%`,
          "scan-info": `${result.issues.length} issue(s) found`,
          "scan-bar": { value: result.healthScore },
          "status-text": fix ? `Fixed ${result.fixed}` : `${result.filesExamined} files scanned`
        });
      }

      // Reset title after a delay
      setTimeout(() => {
        if (actionObj.isKey() || actionObj.isDial()) {
          actionObj.setTitle("Deep\nScan");
        }
      }, 5000);
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("DeepScan fatal error:", err);
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Deep\nScan");
      }
    }
  }
}
