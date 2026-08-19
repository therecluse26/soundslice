import { EditorTrack } from "@/stores/audio-store";
import { countHiddenRegions } from "@/lib/advanced-settings";
import { useEffectiveView } from "@/hooks/useEffectiveView";

/**
 * Warns that this track has regions Simple view will not export.
 *
 * Simple view draws the first region by start time and exports only that one.
 * Ticket 003 reversed the original plan of exporting every region: four files
 * from one visible region is a surprise the user only finds afterwards.
 *
 * This chip **cannot be dismissed**. A bare count would not say "these will not
 * export", which is the part that matters.
 *
 * The component owns its own view check and its own spacing, so nothing takes up
 * room when there is nothing to say.
 *
 * Renders nothing when nothing is hidden, which is every case today.
 */
export function HiddenRegionsChip({ track }: { track: EditorTrack }) {
  const view = useEffectiveView();
  const hidden = countHiddenRegions(track);

  if (view !== "simple" || hidden === 0) return null;

  return (
    <div className="mt-1">
      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-500">
        {hidden} {hidden === 1 ? "region" : "regions"} hidden — switch to
        Advanced to export {hidden === 1 ? "it" : "them"}
      </span>
    </div>
  );
}
