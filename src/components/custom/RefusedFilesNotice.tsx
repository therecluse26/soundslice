import { useAudioStore } from "@/stores/audio-store";
import { Button } from "@/components/ui/button";
import { countRender } from "@/lib/render-count";

/**
 * Why a dropped file was not loaded.
 *
 * The memory ceiling **refuses, it never evicts**. That is the worker boundary
 * design's section 6, and it is the half that needs a screen: a file that
 * silently fails to appear reads as a bug in the uploader.
 *
 * Nothing already loaded is ever removed to make room, so this message can
 * always end by saying so.
 */
export const RefusedFilesNotice = () => {
  if (import.meta.env.DEV) countRender("RefusedFilesNotice");

  const refusal = useAudioStore((state) => state.refusal);
  const clearRefusal = useAudioStore((state) => state.clearRefusal);

  if (!refusal) return null;

  return (
    <div
      role="alert"
      className="my-4 flex items-start gap-4 rounded-md border border-dotted border-primary px-4 py-3 text-sm"
    >
      <span className="flex-grow">{refusal}</span>
      <Button
        onClick={clearRefusal}
        className="h-auto shrink-0 px-2 py-1 text-xs"
      >
        Dismiss
      </Button>
    </div>
  );
};
