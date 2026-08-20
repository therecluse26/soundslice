import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useAudioStore } from "@/stores/audio-store";
import { LOUDNESS_TARGET_RANGE } from "@/lib/edit-stack";
import { countRender } from "@/lib/render-count";

/**
 * The loudness target, in LUFS. Advanced view only.
 *
 * Ticket 010's rule is that **Simple view gains no new control**. Simple keeps
 * one Yes/No switch and this number underneath it, at −14 LUFS. Advanced view
 * gets to move it.
 *
 * It is a **master default**, not a per-track setting: one number for the whole
 * export, which is the only way a batch of tracks can come out sounding equally
 * loud. That is what the switch is for.
 *
 * **Advanced only, and therefore lazy-loaded.** It is reached through
 * `AdvancedPanel`, which `AudioEditor` imports dynamically, so a Simple view
 * user never downloads it. Standing rule 6.
 */
export function LoudnessTarget() {
  if (import.meta.env.DEV) countRender("LoudnessTarget");

  const normalizeAudio = useAudioStore((state) => state.normalizeAudio);
  const target = useAudioStore((state) => state.loudnessTargetLufs);
  const setTarget = useAudioStore((state) => state.setLoudnessTargetLufs);

  return (
    <div className="flex flex-col gap-2 py-2">
      <Label className="flex items-baseline justify-between gap-4">
        <span>Loudness target</span>
        <code className="text-primary">{target.toFixed(0)} LUFS</code>
      </Label>

      <Slider
        value={[target]}
        min={LOUDNESS_TARGET_RANGE.min}
        max={LOUDNESS_TARGET_RANGE.max}
        step={1}
        onValueChange={([value]) => setTarget(value)}
        aria-label="Loudness target in LUFS"
      />

      <p className="text-xs text-muted-foreground">
        {normalizeAudio ? (
          <>
            How loud every exported file is made. −14 LUFS is what Spotify
            publishes; −23 LUFS is broadcast. Peaks are held below −1 dBTP, so a
            very peaky track may come out quieter than the target rather than
            clip.
          </>
        ) : (
          <>
            Not in use. Turn <b>Normalize Levels</b> on to apply it.
          </>
        )}
      </p>
    </div>
  );
}
