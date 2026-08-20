import { useEffect } from "react";
import { useAudioStore } from "@/stores/audio-store";

/**
 * Ctrl+Z and Cmd+Z undo. Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo.
 *
 * Mounted **once**, by `Dashboard`. One history serves the whole project — that
 * is [`designs/edit-stack.md`](../../.wayfinder/designs/edit-stack.md) §8 — so
 * one listener serves it. A listener per card would undo once per card on every
 * keypress.
 *
 * ## Undo scrolls to what it changed
 *
 * The design asks for it and the reason is plain: with one history for the whole
 * project, Ctrl+Z can act on a card that is off screen, and a user who sees
 * nothing move concludes undo is broken. The store's `undo` returns the tracks
 * the entry actually changed, and this brings the first of them into view.
 *
 * ## It never fights a text field
 *
 * A region's name is edited in an `<input>`, and Ctrl+Z inside one is the
 * browser's own undo for that text. Typing there and pressing Ctrl+Z must undo
 * the typing, not the last region you dragged.
 */
export function useUndoRedo(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;

      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const redo = (key === "z" && event.shiftKey) || key === "y";
      const undo = key === "z" && !event.shiftKey;

      if (!redo && !undo) return;

      event.preventDefault();

      const { undo: undoGesture, redo: redoGesture } = useAudioStore.getState();
      const changed = redo ? redoGesture() : undoGesture();

      scrollToTrack(changed[0]);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Brings a track's card into view.
 *
 * The card carries `data-track-card`, which is the only thing this needs to
 * know about the DOM. A card that is not on screen — a view the user has
 * scrolled away from — is exactly the case this exists for.
 */
function scrollToTrack(fileName: string | undefined): void {
  if (!fileName) return;

  const card = document.querySelector(
    `[data-track-card="${CSS.escape(fileName)}"]`
  );

  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
