/**
 * NFO Editor Action for MediaMaid (Premium Feature).
 *
 * Creates, views, and edits NFO metadata files for Jellyfin/Kodi libraries.
 * On Stream Deck+, the dial cycles through NFO fields and the touchscreen
 * displays field name/value pairs.
 *
 * Keypad:
 *   Short press  → auto-create NFO for target file/folder
 *   Long press   → dry-run preview (show what would be created)
 *
 * Encoder (Stream Deck+):
 *   Rotate       → browse NFO fields
 *   Push         → save current NFO
 *   Touch        → quick-edit current field
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

import {
  autoCreateNfo,
  readNfoFields,
  getNfoTemplate,
  detectNfoType,
  type NfoType,
  type NfoField
} from "../lib/nfo-writer.js";
import { existsSync } from "fs";
import { LONG_PRESS_MS } from "../lib/config.js";

export interface NfoEditorSettings {
  [key: string]: JsonValue;
  /** Path to the media file or directory to edit NFO for */
  targetPath: string;
  /** NFO type override (auto-detected if empty) */
  nfoType: string;
  /** Premium license key (empty = trial mode) */
  licenseKey: string;
}

@action({ UUID: "com.gameaday.mediamaid.nfoeditor" })
export class NfoEditorAction extends SingletonAction<NfoEditorSettings> {
  private pressTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private currentFields = new Map<string, NfoField[]>();
  private fieldIndex = new Map<string, number>();
  private currentNfoType = new Map<string, NfoType>();

  // ── Keypad handlers ──────────────────────────────────────────────

  override async onKeyDown(ev: KeyDownEvent<NfoEditorSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = setTimeout(() => {
      this.pressTimers.delete(context);
      this.performNfoAction(ev.action, ev.payload.settings, true).catch(err =>
        streamDeck.logger.error("NfoEditor long-press error:", err)
      );
    }, LONG_PRESS_MS);
    this.pressTimers.set(context, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<NfoEditorSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.pressTimers.get(context);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pressTimers.delete(context);
      await this.performNfoAction(ev.action, ev.payload.settings, false);
    }
  }

  // ── Encoder handlers (Stream Deck+) ──────────────────────────────

  override async onDialRotate(ev: DialRotateEvent<NfoEditorSettings>): Promise<void> {
    const context = ev.action.id;
    const fields = this.currentFields.get(context);

    if (!fields || fields.length === 0) {
      await ev.action.setFeedback({
        "title": "NFO Editor ★",
        "field-name": "No NFO",
        "field-value": "Press to create",
        "status-text": ""
      });
      return;
    }

    const current = this.fieldIndex.get(context) ?? 0;
    const delta = ev.payload.ticks > 0 ? 1 : -1;
    const next = (current + delta + fields.length) % fields.length;
    this.fieldIndex.set(context, next);

    const field = fields[next];
    await ev.action.setFeedback({
      "title": `NFO Field ${next + 1}/${fields.length}`,
      "field-name": field.label,
      "field-value": field.value || "(empty)",
      "status-text": field.editable ? "Tap to edit" : "Read only"
    });
  }

  override async onDialDown(ev: DialDownEvent<NfoEditorSettings>): Promise<void> {
    await this.performNfoAction(ev.action, ev.payload.settings, false);
  }

  override async onTouchTap(ev: TouchTapEvent<NfoEditorSettings>): Promise<void> {
    // Touch shows current field details
    const context = ev.action.id;
    const fields = this.currentFields.get(context);
    const idx = this.fieldIndex.get(context) ?? 0;

    if (fields && fields[idx]) {
      const field = fields[idx];
      await ev.action.setFeedback({
        "title": field.label,
        "field-name": field.tag,
        "field-value": field.value || "(not set)",
        "status-text": `Type: ${this.currentNfoType.get(context) ?? "unknown"}`
      });
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<NfoEditorSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (!settings.targetPath) {
      await ev.action.setSettings({
        targetPath: "",
        nfoType: "",
        licenseKey: ""
      });
    }
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("NFO\nEdit ★");
    }

    // Try to load existing NFO
    if (settings.targetPath) {
      await this.loadNfoData(ev.action.id, settings);
    }

    if (ev.action.isDial()) {
      const fields = this.currentFields.get(ev.action.id);
      await ev.action.setFeedback({
        "title": "NFO Editor ★",
        "field-name": fields ? `${fields.length} fields` : "No NFO",
        "field-value": settings.targetPath ? "Loaded" : "",
        "status-text": settings.targetPath ? "Ready" : "Set target path"
      });
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<NfoEditorSettings>): Promise<void> {
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("NFO\nEdit ★");
    }
    await this.loadNfoData(ev.action.id, ev.payload.settings);
  }

  override async onWillDisappear(ev: WillDisappearEvent<NfoEditorSettings>): Promise<void> {
    const timer = this.pressTimers.get(ev.action.id);
    if (timer !== undefined) clearTimeout(timer);
    this.pressTimers.delete(ev.action.id);
    this.currentFields.delete(ev.action.id);
    this.fieldIndex.delete(ev.action.id);
    this.currentNfoType.delete(ev.action.id);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private async loadNfoData(context: string, settings: NfoEditorSettings): Promise<void> {
    if (!settings.targetPath) return;

    try {
      const nfoType = (settings.nfoType as NfoType) || detectNfoType(settings.targetPath);
      this.currentNfoType.set(context, nfoType);

      // Try to find and read existing NFO
      const dir = settings.targetPath;
      const nfoCandidates = [
        `${dir}.nfo`,
        `${dir}/tvshow.nfo`,
        `${dir}/movie.nfo`,
        `${dir}/artist.nfo`,
        `${dir}/album.nfo`
      ];

      for (const candidate of nfoCandidates) {
        if (existsSync(candidate)) {
          const { fields } = await readNfoFields(candidate);
          this.currentFields.set(context, fields);
          this.fieldIndex.set(context, 0);
          return;
        }
      }

      // No existing NFO – use template
      this.currentFields.set(context, getNfoTemplate(nfoType));
      this.fieldIndex.set(context, 0);
    } catch (err) {
      streamDeck.logger.error("NfoEditor loadNfoData error:", err);
    }
  }

  private async performNfoAction(
    actionObj: Action<NfoEditorSettings>,
    settings: NfoEditorSettings,
    dryRun: boolean
  ): Promise<void> {
    if (!settings.targetPath) {
      await actionObj.showAlert();
      streamDeck.logger.warn("NfoEditor: no target path configured.");
      return;
    }

    try {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle(dryRun ? "Preview…" : "Saving…");
      }

      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": dryRun ? "Dry Run" : "Saving",
          "field-name": "",
          "field-value": "",
          "status-text": "Working…"
        });
      }

      const result = await autoCreateNfo(settings.targetPath, undefined, dryRun);

      if (result.success) {
        if (actionObj.isKey()) {
          await actionObj.showOk();
        }
        streamDeck.logger.info(`NfoEditor: ${result.message} (${result.nfoPath})`);
      } else {
        await actionObj.showAlert();
        streamDeck.logger.error(`NfoEditor: ${result.message}`);
      }

      // Reload NFO data
      await this.loadNfoData(actionObj.id, settings);

      if (actionObj.isDial()) {
        const fields = this.currentFields.get(actionObj.id);
        await actionObj.setFeedback({
          "title": "NFO Editor ★",
          "field-name": fields ? `${fields.length} fields` : "Error",
          "field-value": result.success ? "Saved" : "Failed",
          "status-text": result.message
        });
      }
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("NfoEditor fatal error:", err);
    } finally {
      if (actionObj.isKey() || actionObj.isDial()) {
        await actionObj.setTitle("NFO\nEdit ★");
      }
    }
  }
}
