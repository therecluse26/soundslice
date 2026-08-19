import { useAudioStore } from "@/stores/audio-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { ADVANCED_MEDIA_QUERY, View, effectiveView } from "@/lib/view";

/**
 * The view actually in force.
 *
 * Below 800 px this is always Simple, however the stored view reads. The stored
 * view is never rewritten, so choosing Advanced on a desktop survives a visit on
 * a phone.
 *
 * Subscribes to `view` alone, so changing a track never re-runs this.
 */
export function useEffectiveView(): View {
  const storedView = useAudioStore((state) => state.view);
  const screenIsWideEnough = useMediaQuery(ADVANCED_MEDIA_QUERY);
  return effectiveView(storedView, screenIsWideEnough);
}
