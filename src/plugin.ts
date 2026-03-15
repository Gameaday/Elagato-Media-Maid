/**
 * MediaMaid – Stream Deck Plugin Entry Point
 *
 * Registers all actions and connects to the Stream Deck application.
 * Built against Elgato Stream Deck SDK 2.0 (SDK 3 standard).
 */

import streamDeck from "@elgato/streamdeck";

import { QuickRenameAction } from "./actions/quick-rename.js";
import { SmartFixAction } from "./actions/smart-fix.js";
import { UndoAction } from "./actions/undo-action.js";
import { NukeDownloadsAction } from "./actions/nuke-downloads.js";
import { DeepScanAction } from "./actions/deep-scan.js";
import { CollectionHealerAction } from "./actions/collection-healer.js";
import { NfoEditorAction } from "./actions/nfo-editor.js";
import { LibraryStatsAction } from "./actions/library-stats.js";

streamDeck.logger.setLevel("info");

// Core actions (free)
streamDeck.actions.registerAction(new QuickRenameAction());
streamDeck.actions.registerAction(new SmartFixAction());
streamDeck.actions.registerAction(new UndoAction());
streamDeck.actions.registerAction(new NukeDownloadsAction());
streamDeck.actions.registerAction(new DeepScanAction());
streamDeck.actions.registerAction(new CollectionHealerAction());

// Premium actions
streamDeck.actions.registerAction(new NfoEditorAction());

// Stream Deck+ exclusive
streamDeck.actions.registerAction(new LibraryStatsAction());

streamDeck.connect();
