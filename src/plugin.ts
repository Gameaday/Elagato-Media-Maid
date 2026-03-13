/**
 * MediaMaid – Stream Deck Plugin Entry Point
 *
 * Registers all actions and connects to the Stream Deck application.
 */

import streamDeck from "@elgato/streamdeck";

import { QuickRenameAction } from "./actions/quick-rename.js";
import { SmartFixAction } from "./actions/smart-fix.js";
import { UndoAction } from "./actions/undo-action.js";
import { NukeDownloadsAction } from "./actions/nuke-downloads.js";

streamDeck.logger.setLevel(2); // LogLevel.INFO

streamDeck.actions.registerAction(new QuickRenameAction());
streamDeck.actions.registerAction(new SmartFixAction());
streamDeck.actions.registerAction(new UndoAction());
streamDeck.actions.registerAction(new NukeDownloadsAction());

streamDeck.connect();
