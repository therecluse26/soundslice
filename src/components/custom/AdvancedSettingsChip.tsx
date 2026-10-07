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
 * Renders nothing when the count is zero.
 */
export function AdvancedSettingsChip() {
  const view = useEffectiveView();
  // Selects the count, not the array, so this redraws only when the number
  // changes — not every time any track changes.
  const count = useAudioStore((state) =>
    countAdvancedSettings(state.tracks, {
      exportFileType: state.exportFileType,
      bitDepth: state.bitDepth,
      outputSampleRate: state.outputSampleRate,
      joinMode: state.joinMode,
    })
  );

  const clear = useAudioStore((state) => state.clearAdvancedSettings);

  if (view !== "simple" || count === 0) return null;

  return (
    <div className="mb-2 flex justify-end">
      <span className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-1 text-xs text-primary">
        {count} Advanced {count === 1 ? "setting" : "settings"} active
        {/*
          One gesture that puts every track and the master back to what Simple
          view can show, so this chip reads zero afterwards. Ctrl+Z puts all of
          it back. Ticket 031.
        */}
        <button
          type="button"
          className="rounded-full px-2 py-0.5 hover:bg-primary/20"
          title="Put every track back to what Simple view shows. Ctrl+Z undoes it."
          onClick={clear}
        >
          Clear
        </button>
      </span>
    </div>
  );
}
