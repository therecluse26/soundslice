import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useAudioStore } from "@/stores/audio-store";
import { LOUDNESS_TARGET_RANGE } from "@/lib/edit-stack";
import { countRender } from "@/lib/render-count";

/**
 * The **master** loudness target, in LUFS. Advanced view only.
 *
 * ## Why it is on the toolbar and not on a card
 *
 * It used to sit at the top of a track card's Sound section, and ticket 027 put
 * a Loudness block in that same card's signal chain. Two targets on one screen
 * is one too many, and the user said so.
 *
 * They are not the same number, which is exactly why only one of them belongs
 * here:
 *
 * | Control | Sets | For |
 * |---|---|---|
 * | this one, on the toolbar | the master default | every track that has not claimed its own chain |
 * | the Loudness block, in the chain | that track's own target | one track |
 *
 * A master default belongs beside the other master defaults, next to the switch
 * that turns it on. Deleting it instead would have cost the one thing it is for:
 * bringing a **batch** of tracks to one loudness in a single action.
 *
 * Ticket 010's rule still holds — **Simple view gains no new control.** Simple
 * keeps one Yes/No switch and this number underneath it at −14 LUFS, unseen.
 *
 * **Advanced only, and therefore lazy-loaded.** `MasterToolbar` is in Simple
 * view's bundle, so this is reached through a dynamic import and needs a default
 * export. Standing rule 6.
 */
export default function LoudnessTarget() {
  if (import.meta.env.DEV) countRender("LoudnessTarget");

  const normalizeAudio = useAudioStore((state) => state.normalizeAudio);
  const target = useAudioStore((state) => state.loudnessTargetLufs);
  const setTarget = useAudioStore((state) => state.setLoudnessTargetLufs);

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <Label className="flex items-baseline justify-between gap-2 text-xs font-normal text-muted-foreground">
        <span>Target for every track</span>
        <code className={normalizeAudio ? "text-primary" : "text-muted-foreground"}>
          {target.toFixed(0)} LUFS
        </code>
      </Label>

      <Slider
        value={[target]}
        min={LOUDNESS_TARGET_RANGE.min}
        max={LOUDNESS_TARGET_RANGE.max}
        step={1}
        onValueChange={([value]) => setTarget(value)}
        aria-label="Master loudness target in LUFS"
      />
    </div>
  );
}
