import { useAudioStore } from "@/stores/audio-store";
import { SliceProgress } from "@/lib/audio-service";
import { countRender } from "@/lib/render-count";

/**
 * How far the running export has got.
 *
 * Standing rule 7: anything over 300 ms shows progress. Slicing ten 5-minute
 * MP3s is most of a minute, and until now the only signal was a wave animation
 * that looked identical at second one and second fifty.
 *
 * **It subscribes to the store itself.** The export reports progress many times
 * a second, and `Dashboard` reading it would redraw every track card on every
 * tick. This component is the only thing that redraws.
 */
export const SliceProgressLabel = () => {
  if (import.meta.env.DEV) countRender("SliceProgressLabel");

  const progress = useAudioStore((state) => state.sliceProgress);
  if (!progress) return null;

  return (
    <div className="text-center text-sm text-muted-foreground">
      {describe(progress)}
    </div>
  );
};

const PHASE_WORD: Record<SliceProgress["phase"], string> = {
  render: "Applying effects",
  encode: "Encoding",
  zip: "Building the zip",
};

function describe(progress: SliceProgress): string {
  const percent = Math.round(
    Math.max(0, Math.min(1, progress.phaseProgress)) * 100
  );

  if (progress.phase === "zip") {
    return `${PHASE_WORD.zip} — ${percent}%`;
  }

  const which =
    progress.fileCount > 1
      ? `File ${progress.fileIndex + 1} of ${progress.fileCount}`
      : progress.fileName;

  return `${which} — ${PHASE_WORD[progress.phase].toLowerCase()} ${percent}%`;
}
