/**
 * LibraryStats Action for MediaMaid.
 *
 * Stream Deck+ only (Encoder controller).
 * Displays real-time library statistics on the touchscreen:
 * file counts by type, total size, naming health score.
 *
 * Encoder:
 *   Rotate       → cycle through different stats
 *   Push         → refresh statistics
 *   Touch        → show detailed breakdown
 */

import streamDeck, {
  action,
  SingletonAction,
  type Action,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DidReceiveSettingsEvent,
  type DialRotateEvent,
  type DialDownEvent,
  type TouchTapEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { calculateLibraryStats, type LibraryStats } from "../lib/library-stats.js";
import { MIN_REFRESH_INTERVAL_S } from "../lib/config.js";

export interface LibraryStatsSettings {
  [key: string]: JsonValue;
  /** Root directory to monitor */
  libraryRoot: string;
  /** Auto-refresh interval in seconds (0 = manual only) */
  refreshInterval: number;
}

@action({ UUID: "com.gameaday.mediamaid.librarystats" })
export class LibraryStatsAction extends SingletonAction<LibraryStatsSettings> {
  private statsCache = new Map<string, LibraryStats>();
  private statIndex = new Map<string, number>();
  private refreshTimers = new Map<string, ReturnType<typeof setInterval>>();

  // ── Encoder handlers (Stream Deck+ only) ─────────────────────────

  override async onDialRotate(ev: DialRotateEvent<LibraryStatsSettings>): Promise<void> {
    const context = ev.action.id;
    const stats = this.statsCache.get(context);

    if (!stats) {
      await ev.action.setFeedback({
        "title": "Library Stats",
        "stat-label": "No data",
        "stat-value": "",
        "health-bar": { value: 0 },
        "health-text": "Press to scan",
        "footer": ""
      });
      return;
    }

    const current = this.statIndex.get(context) ?? 0;
    const delta = ev.payload.ticks > 0 ? 1 : -1;
    const next = (current + delta + stats.displayStats.length) % stats.displayStats.length;
    this.statIndex.set(context, next);

    const stat = stats.displayStats[next];
    await ev.action.setFeedback({
      "title": "Library Stats",
      "stat-label": stat.label,
      "stat-value": stat.value,
      "health-bar": { value: Math.round(stats.confidence * 100) },
      "health-text": `${stats.detectedType.replace(/_/g, " ")}`,
      "footer": `${next + 1}/${stats.displayStats.length}`
    });
  }

  override async onDialDown(ev: DialDownEvent<LibraryStatsSettings>): Promise<void> {
    await this.refreshStats(ev.action, ev.payload.settings);
  }

  override async onTouchTap(ev: TouchTapEvent<LibraryStatsSettings>): Promise<void> {
    const context = ev.action.id;
    const stats = this.statsCache.get(context);

    if (!stats) {
      await this.refreshStats(ev.action, ev.payload.settings);
      return;
    }

    // Show detailed category breakdown
    const categories = Object.entries(stats.categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join(", ");

    await ev.action.setFeedback({
      "title": "Breakdown",
      "stat-label": stats.totalSizeFormatted,
      "stat-value": `${stats.totalFiles} files`,
      "health-bar": { value: Math.round(stats.confidence * 100) },
      "health-text": categories || "No files",
      "footer": stats.detectedType.replace(/_/g, " ")
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async onWillAppear(ev: WillAppearEvent<LibraryStatsSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (!settings.libraryRoot) {
      await ev.action.setSettings({
        libraryRoot: "",
        refreshInterval: 0
      });
    }

    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Stats");
    }

    if (ev.action.isDial()) {
      await ev.action.setFeedback({
        "title": "Library Stats",
        "stat-label": "Press dial",
        "stat-value": "to refresh",
        "health-bar": { value: 0 },
        "health-text": "",
        "footer": settings.libraryRoot ? "Ready" : "Set library root"
      });
    }

    // Set up auto-refresh if configured
    if (settings.refreshInterval > 0 && settings.libraryRoot) {
      this.setupAutoRefresh(ev.action, settings);
    }

    // Initial scan if path is set
    if (settings.libraryRoot) {
      await this.refreshStats(ev.action, settings);
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<LibraryStatsSettings>): Promise<void> {
    if (ev.action.isKey() || ev.action.isDial()) {
      await ev.action.setTitle("Stats");
    }

    // Clear existing auto-refresh
    const context = ev.action.id;
    const existing = this.refreshTimers.get(context);
    if (existing) {
      clearInterval(existing);
      this.refreshTimers.delete(context);
    }

    // Set up new auto-refresh if configured
    const { settings } = ev.payload;
    if (settings.refreshInterval > 0 && settings.libraryRoot) {
      this.setupAutoRefresh(ev.action, settings);
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<LibraryStatsSettings>): Promise<void> {
    const context = ev.action.id;
    const timer = this.refreshTimers.get(context);
    if (timer) clearInterval(timer);
    this.refreshTimers.delete(context);
    this.statsCache.delete(context);
    this.statIndex.delete(context);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private setupAutoRefresh(
    actionObj: Action<LibraryStatsSettings>,
    settings: LibraryStatsSettings
  ): void {
    const intervalMs = Math.max(MIN_REFRESH_INTERVAL_S, settings.refreshInterval) * 1000;
    const timer = setInterval(() => {
      this.refreshStats(actionObj, settings).catch(err =>
        streamDeck.logger.error("LibraryStats auto-refresh error:", err)
      );
    }, intervalMs);
    this.refreshTimers.set(actionObj.id, timer);
  }

  private async refreshStats(
    actionObj: Action<LibraryStatsSettings>,
    settings: LibraryStatsSettings
  ): Promise<void> {
    if (!settings.libraryRoot) {
      await actionObj.showAlert();
      return;
    }

    try {
      const stats = await calculateLibraryStats(settings.libraryRoot);
      this.statsCache.set(actionObj.id, stats);
      this.statIndex.set(actionObj.id, 0);

      if (actionObj.isKey()) {
        await actionObj.showOk();
      }
      streamDeck.logger.info(
        `LibraryStats: ${stats.totalFiles} files, ${stats.totalSizeFormatted}, ` +
        `type: ${stats.detectedType}, confidence: ${Math.round(stats.confidence * 100)}%`
      );

      const firstStat = stats.displayStats[0];
      if (actionObj.isDial()) {
        await actionObj.setFeedback({
          "title": "Library Stats",
          "stat-label": firstStat?.label ?? "Total Files",
          "stat-value": firstStat?.value ?? "0",
          "health-bar": { value: Math.round(stats.confidence * 100) },
          "health-text": stats.detectedType.replace(/_/g, " "),
          "footer": `${stats.totalSizeFormatted} • ${stats.displayStats.length} stats`
        });
      }
    } catch (err) {
      await actionObj.showAlert();
      streamDeck.logger.error("LibraryStats refresh error:", err);
    }
  }
}
