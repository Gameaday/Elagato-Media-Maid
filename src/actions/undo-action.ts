/**
 * UndoAction for MediaMaid.
 *
 * Reverts the most recent rename or organization operation by restoring
 * all files to their original paths.
 */

import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent
} from "@elgato/streamdeck";

import { peekUndoSnapshot, popUndoSnapshot, applyUndo, undoStackSize } from "../lib/undo-manager.js";
import { logOperation } from "../lib/logger.js";

@action({ UUID: "com.gameaday.mediamaid.undo" })
export class UndoAction extends SingletonAction {
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const snapshot = peekUndoSnapshot();

    if (!snapshot) {
      await ev.action.showAlert();
      streamDeck.logger.info("Undo: nothing to undo.");
      await ev.action.setTitle("Nothing\nto Undo");
      setTimeout(() => this.refreshTitle(ev.action), 3000);
      return;
    }

    try {
      await ev.action.setTitle("Undoing…");
      const errors = await applyUndo(snapshot);

      if (errors.length > 0) {
        await ev.action.showAlert();
        streamDeck.logger.error("Undo errors:", errors);
        errors.forEach(e =>
          logOperation({ operation: "error", message: `Undo: ${e}` })
        );
      } else {
        // Remove the snapshot only after successful undo
        popUndoSnapshot();
        await ev.action.showOk();
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
      await this.refreshTitle(ev.action);
    }
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refreshTitle(ev.action);
  }

  private async refreshTitle(action: { setTitle(title: string): Promise<void> }): Promise<void> {
    const count = undoStackSize();
    await action.setTitle(count > 0 ? `Undo\n(${count})` : "Undo");
  }
}
