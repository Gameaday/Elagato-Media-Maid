/**
 * CollectionHealer Action for MediaMaid.
 *
 * Diagnoses and batch-fixes naming issues across entire media collections.
 * Infers metadata from folder context and optionally enriches via internet lookup.
 *
 * Keypad:
 *   Short press  → diagnose + heal collection
 *   Long press   → dry run (preview in log, no changes)
 *
 * Encoder (Stream Deck+):
 *   Rotate       → browse diagnosed issues
 *   Push         → heal collection
 *   Touch        → diagnose only (no changes)
 *   Long Touch   → dry-run heal
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

import { diagnoseCollection, healCollection, type DiagnoseResult } from "../lib/healer.js";
import { MediaType } from "../lib/patterns.js";
import { LONG_PRESS_MS } from "../lib/config.js";
import type { LookupConfig } from "../lib/metadata-lookup.js";

export interface CollectionHealerSettings {
  [key: string]: JsonValue;
  /** Root directory of the collection */
  collectionPath: string;
  /** Target naming standard (or "auto" for SmartFix detection) */
  targetType: string;
  /** Whether to enable internet metadata lookups */
  enableLookup: boolean;
  /** TMDB API key for TV/Movie/Anime lookups */
  tmdbApiKey: string;
}

const HEAL_RESET_MS = 8_000;

@action({ UUID: "com.gameaday.mediamaid.healer" })
export class CollectionHealerAction extends SingletonAction<CollectionHealerSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastDiagnosis = new Map<string, DiagnoseResult>();
  private issueIndex = new Map<string, number>();

  // ── Keypad handlers ──────────────────────────────────────────────

  override async onKeyDown(ev: KeyDownEvent<CollectionHealerSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performHeal(ev.action, ev.payload.settings, true).catch(err =>
        streamDeck.logger.error("Healer long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<CollectionHealerSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performHeal(ev.action, ev.payload.settings, false);
    }
  }

  // ── Encoder handlers (Stream Deck+) ──────────────────────────────

  override async onDialRotate(ev: DialRotateEvent<CollectionHealerSettings>): Promise<void> {
    const context = ev.action.id;
    const diag = this.lastDiagnosis.get(context);
    if (!diag || diag.issues.length === 0) {
      await ev.action.setFeedback({
        "title": "Healer",
        "heal-info": "No results yet",
        "heal-bar": { value: 0 },
        "status-text": "Press to diagnose"
      });
      return;
    }

    const current = this.issueIndex.get(context) ?? 0;
    const delta = ev.payload.ticks > 0 ? 1 : -1;
    const next = (current + delta + diag.issues.length) % diag.issues.length;
    this.issueIndex.set(context, next);

    const issue = diag.issues[next];
    await ev.action.setFeedback({
      "title": `Issue ${next + 1}/${diag.issues.length}`,
      "heal-info": `${issue.kind}: ${issue.currentName}`,
      "heal-bar": { value: diag.healthScore },
      "status-text": issue.description
    });
  }

  override async onDialDown(ev: DialDownEvent<CollectionHealerSettings>): Promise<void> {
    await this.performHeal(ev.action, ev.payload.settings, false);
  }

  override async onTouchTap(ev: TouchTapEvent<CollectionHealerSettings>): Promise<void> {
    if (ev.payload.hold) {
      await this.performHeal(ev.action, ev.payload.settings, true);
      return;
    }
    // Touch = diagnose only
    await this.performDiagnose(ev.action, ev.payload.settings);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<CollectionHealerSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (!settings.collectionPath) {
      await ev.action.setSettings({
        collectionPath: "",
        targetType: "auto",
        enableLookup: false,
        tmdbApiKey: ""
      });
    }
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Heal");
    }
    if (ev.action.isDial()) {
      await ev.action.setFeedback({
        "title": "Healer",
        "heal-info": "Not scanned",
        "heal-bar": { value: 0 },
        "status-text": settings.collectionPath ? "Ready" : "Set collection path"
      });
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CollectionHealerSettings>): Promise<void> {
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Heal");
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<CollectionHealerSettings>): Promise<void> {
    const timer = this.pressTimers.get(ev.action.id);
    if (timer !== undefined) clearTimeout(timer);
    this.pressTimers.delete(ev.action.id);
    this.lastDiagnosis.delete(ev.action.id);
    this.issueIndex.delete(ev.action.id);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private buildLookupConfig(settings: CollectionHealerSettings): LookupConfig | undefined {
    return settings.enableLookup
      ? { enabled: true, tmdbApiKey: settings.tmdbApiKey || undefined }
      : undefined;
  }

  private resolveTargetType(settings: CollectionHealerSettings): MediaType | undefined {
    if (!settings.targetType || settings.targetType === "auto") return undefined;
    return settings.targetType as MediaType;
  }

  private async performDiagnose(
    actionObj: Action<CollectionHealerSettings>,
    settings: CollectionHealerSettings
  ): Promise<void> {
    if (!settings.collectionPath) {
      await actionObj.showAlert();
      streamDeck.logger.warn("Healer: no collection path configured.");
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Scanning…");
      }
      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Diagnosing…",
          "heal-info": "Analyzing collection",
          "heal-bar": { value: 25 },
          "status-text": "Please wait…"
        });
      }

      const result = await diagnoseCollection(settings.collectionPath);

      this.lastDiagnosis.set(actionObj.id, result);
      this.issueIndex.set(actionObj.id, 0);

      streamDeck.logger.info(
        `Healer diagnose: ${result.filesExamined} files, ${result.issues.length} issues, health ${result.healthScore}%`
      );

      if (actionObj.isKey()) await actionObj.showOk();
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(`${result.healthScore}%`);
      }
      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": `Health: ${result.healthScore}%`,
          "heal-info": `${result.issues.length} issue(s)`,
          "heal-bar": { value: result.healthScore },
          "status-text": `${result.filesExamined} files scanned`
        });
      }

      setTimeout(() => {
        if (actionObj.isKey() || actionObj.isDial()) {
          actionObj.setTitle("Heal");
        }
      }, HEAL_RESET_MS);
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("Healer diagnose error:", err);
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Heal");
      }
    }
  }

  private async performHeal(
    actionObj: Action<CollectionHealerSettings>,
    settings: CollectionHealerSettings,
    dryRun: boolean
  ): Promise<void> {
    if (!settings.collectionPath) {
      await actionObj.showAlert();
      streamDeck.logger.warn("Healer: no collection path configured.");
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(dryRun ? "Dry Run…" : "Healing…");
      }
      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run" : "Healing…",
          "heal-info": "Working…",
          "heal-bar": { value: 50 },
          "status-text": "Please wait…"
        });
      }

      const targetType = this.resolveTargetType(settings);
      const lookupConfig = this.buildLookupConfig(settings);
      const result = await healCollection(settings.collectionPath, dryRun, targetType, lookupConfig);

      // Also diagnose for browsable results
      const diag = await diagnoseCollection(settings.collectionPath);
      this.lastDiagnosis.set(actionObj.id, diag);
      this.issueIndex.set(actionObj.id, 0);

      const healed = dryRun ? result.wouldHeal : result.healed;

      if (actionObj.isKey()) await actionObj.showOk();

      streamDeck.logger.info(
        `Healer: ${dryRun ? "DRY RUN" : "healed"} ${healed}/${result.filesExamined} files`
      );

      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(dryRun ? `${healed}\npreview` : `${healed}\nhealed`);
      }
      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run Complete" : "Healing Complete",
          "heal-info": `${healed} file(s) ${dryRun ? "would change" : "healed"}`,
          "heal-bar": { value: diag.healthScore },
          "status-text": `Health: ${diag.healthScore}%`
        });
      }

      setTimeout(() => {
        if (actionObj.isKey() || actionObj.isDial()) {
          actionObj.setTitle("Heal");
        }
      }, HEAL_RESET_MS);
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("Healer fatal error:", err);
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("Heal");
      }
    }
  }
}
