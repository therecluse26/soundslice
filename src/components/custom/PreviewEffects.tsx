import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAudioStore } from "@/stores/audio-store";
import type { PreviewState } from "@/hooks/usePreview";

/**
 * The **Preview effects** switch, and what preview cannot promise.
 *
 * ## Why it is in both views
 *
 * Ticket 010 set a rule: Simple view gains no new control. That rule was written
 * about the loudness target, a number that needs audio knowledge to set. This is
 * a listen switch. It changes no exported file, and a Simple user who cannot
 * hear the raw cut cannot tell what the two switches did. So it appears in both
 * views, and ticket 019 says why in full.
 *
 * It is **not** counted on the Advanced settings chip for the same reason: the
 * chip warns that an export is not what Simple view describes, and this never
 * is.
 *
 * ## The note underneath
 *
 * Loudness and peak normalization cannot know their gain until something has
 * heard the whole region. Preview measures that itself for anything up to ten
 * minutes. Above that the wait becomes a freeze, so it says the level is not
 * normalized and offers to measure anyway — the same way the memory ceiling
 * refuses out loud rather than deciding quietly.
 */
export function PreviewEffects({
  fileName,
  effects,
  preview,
}: {
  fileName: string;
  effects: boolean;
  preview: PreviewState;
}) {
  const setTrackPreviewEffects = useAudioStore(
    (state) => state.setTrackPreviewEffects
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={`preview-effects-${fileName}`}
          checked={effects}
          onCheckedChange={(on) => setTrackPreviewEffects(fileName, on)}
        />
        <Label
          htmlFor={`preview-effects-${fileName}`}
          className="text-xs font-normal cursor-pointer"
        >
          Preview effects
        </Label>
      </div>

      {effects && <PreviewNote preview={preview} />}
    </div>
  );
}

function PreviewNote({ preview }: { preview: PreviewState }) {
  if (preview.measuring) {
    return (
      <p className="text-xs text-muted-foreground">
        Measuring loudness, so preview matches the export…
      </p>
    );
  }

  if (!preview.awaitingMeasurement) return null;

  if (!preview.tooLongToMeasure) return null;

  return (
    <p className="text-xs text-muted-foreground">
      This region is over ten minutes, so the level you hear is not the level you
      will export.{" "}
      <Button
        variant="link"
        className="h-auto p-0 text-xs align-baseline"
        onClick={preview.measureNow}
      >
        Measure anyway
      </Button>
      .
    </p>
  );
}
