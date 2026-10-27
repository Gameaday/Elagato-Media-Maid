/**
 * UndoAction for MediaMaid.
 *
 * Reverts the most recent rename or organization operation by restoring
 * all files to their original paths.
 *
 * Titles stay live (#14): the action subscribes to the undo stack, so
 * every Undo key refreshes whenever any write action journals a snapshot
 * — not only when an Undo key happens to appear or is pressed. After a
 * successful undo the reverted batch's label flashes on the key before
 * the title resets.
 */

import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent
} from "@elgato/streamdeck";

import { peekUndoSnapshot, popUndoSnapshot, replaceTopSnapshot, applyUndo, undoStackSize, subscribeUndoStack } from "../lib/undo-manager.js";
import { STATUS_RESET_MS } from "../lib/config.js";
import { logOperation } from "../lib/logger.js";

/**
 * Guards against subscribing more than once. The class is a singleton,
 * but the constructor may run in module tests or if the module is
 * evaluated twice under different loaders.
 */
let subscribed = false;

@action({ UUID: "com.gameaday.mediamaid.undo" })
export class UndoAction extends SingletonAction {
  constructor() {
    super();
    if (!subscribed) {
      subscribed = true;
      // Any change to the persisted undo stack (a write action journaling
      // its batch, an undo popping it) refreshes every Undo key title.
      subscribeUndoStack(() => this.refreshAllTitles());
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const snapshot = peekUndoSnapshot();

    if (!snapshot) {
      await ev.action.showAlert();
      streamDeck.logger.info("Undo: nothing to undo.");
      await ev.action.setTitle("Nothing\nto Undo");
      setTimeout(() => this.refreshTitle(ev.action), STATUS_RESET_MS);
      return;
    }

    let undoneLabel: string | undefined;
    try {
      await ev.action.setTitle("Undoing…");
      const errors = await applyUndo(snapshot);

      if (errors.length > 0) {
        await ev.action.showAlert();
        streamDeck.logger.error("Undo errors:", errors);
        errors.forEach(e =>
          logOperation({ operation: "error", message: `Undo: ${e}` })
        );
        // applyUndo() trimmed the snapshot down to the operations that
        // could not be reverted. Persist that remainder so the next Undo
        // press retries only what is left — otherwise a single locked
        // file would block the whole snapshot forever (every press
        // re-failing on the already-reverted operations).
        if (snapshot.operations.length > 0) {
          replaceTopSnapshot(snapshot);
        } else {
          popUndoSnapshot();
        }
      } else {
        // Remove the snapshot only after successful undo
        popUndoSnapshot();
        await ev.action.showOk();
        undoneLabel = snapshot.label;
        logOperation({
          operation: "undo",
          message: `Undid: "${snapshot.label}" (${snapshot.operations.length} operation(s))`
        });
        streamDeck.logger.info(
          `Undo successful: "${snapshot.label}" (${snapshot.operations.length} ops)`
        );
      }
    } catch (err) {
      await ev.action.showAlert();
      streamDeck.logger.error("Undo fatal error:", err);
    } finally {
      if (undoneLabel !== undefined) {
        // Flash the reverted batch's label before the title resets to the
        // live stack count (#14). Truncate long labels to fit the key.
        const short =
          undoneLabel.length > 16 ? undoneLabel.slice(0, 15) + "…" : undoneLabel;
        await ev.action.setTitle(`Undid\n${short}`);
        setTimeout(() => this.refreshTitle(ev.action), STATUS_RESET_MS);
      } else {
        await this.refreshTitle(ev.action);
      }
    }
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refreshTitle(ev.action);
  }

  /**
   * Refresh the title on every currently visible Undo key.
   * Called whenever the persisted undo stack changes.
   */
  private refreshAllTitles(): void {
    for (const other of this.actions) {
      void this.refreshTitle(other);
    }
  }

  private async refreshTitle(action: { setTitle(title: string): Promise<void> }): Promise<void> {
    const count = undoStackSize();
    await action.setTitle(count > 0 ? `Undo\n(${count})` : "Undo");
  }
}
