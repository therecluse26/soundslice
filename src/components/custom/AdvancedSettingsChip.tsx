import { useAudioStore } from "@/stores/audio-store";
import { countAdvancedSettings } from "@/lib/advanced-settings";
import { useEffectiveView } from "@/hooks/useEffectiveView";

/**
 * Tells a Simple view user that Advanced settings are still in force.
 *
 * Switching to Simple never deletes anything, so a user can be carrying
 * settings Simple cannot show. This is how they find out.
 *
 * The component owns its own view check **and its own spacing**. An empty
 * wrapper with a margin still occupies space, which moved the waveform by 8 px
 * when the view changed. This ticket's acceptance forbids that.
 *
 * Renders nothing when the count is zero, which is every case today.
 */
export function AdvancedSettingsChip() {
  const view = useEffectiveView();
  // Selects the count, not the array, so this redraws only when the number
  // changes — not every time any track changes.
  const count = useAudioStore((state) => countAdvancedSettings(state.tracks));

  if (view !== "simple" || count === 0) return null;

  return (
    <div className="mb-2 flex justify-end">
      <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
        {count} Advanced {count === 1 ? "setting" : "settings"} active
      </span>
    </div>
  );
}
