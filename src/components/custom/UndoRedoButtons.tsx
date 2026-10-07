import { ResetIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { useAudioStore } from "@/stores/audio-store";
import { nextRedoLabel, nextUndoLabel } from "@/lib/history";
import { scrollToTrack } from "@/hooks/useUndoRedo";

/**
 * Undo and Redo, in the header, **named for what they will do**. Ticket 030.
 *
 * The keyboard has had them since ticket 024. A button is how a user who does
 * not know the shortcut finds out undo exists — and the label is how anyone
 * learns what it will undo before pressing it. "Undo Remove track" is a promise;
 * a bare arrow is a guess.
 *
 * Both views. Undo is not an Advanced idea.
 */
export function UndoRedoButtons() {
  const undoLabel = useAudioStore((state) => nextUndoLabel(state.history));
  const redoLabel = useAudioStore((state) => nextRedoLabel(state.history));

  const run = (which: "undo" | "redo") => {
    const changed = useAudioStore.getState()[which]();
    scrollToTrack(changed[0]);
  };

  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!undoLabel}
        aria-label={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
        title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : "Nothing to undo"}
        onClick={() => run("undo")}
      >
        <ResetIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={!redoLabel}
        aria-label={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
        title={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"}
        onClick={() => run("redo")}
      >
        <ResetIcon className="-scale-x-100" />
      </Button>
    </div>
  );
}
