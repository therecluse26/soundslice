import { Button } from "@/components/ui/button";
import { useAudioStore } from "@/stores/audio-store";
import { ExportOverrides, hasExportOverrides } from "@/lib/track-work";
import { countRender } from "@/lib/render-count";
import { BitDepthField, FormatField, SampleRateField } from "./ExportFields";

/**
 * The inspector's **Export** tab: what this track exports as. Advanced view
 * only. Ticket 033. The join order and its crossfades are in the region table,
 * which becomes the join order while a join is on.
 *
 * ## Overrides, not a second copy of the master
 *
 * Each row starts at **Master (…)**, which is no override at all — the track
 * follows the master toolbar, and changing the master changes it. Choosing any
 * other value makes it this track's own, marked with a dot. **Reset to master**
 * takes every one away in one gesture. Ticket 003's override model, the same
 * one the Sound section's stack follows.
 *
 * These rows used to edit the master defaults from inside a card, so changing
 * one card's bit depth changed every card. The master rows are on the toolbar
 * now, beside the master format.
 *
 * **Join every track** writes one file, so it can have only one format; it uses
 * the master's and this section says the overrides are not in use.
 *
 * **Advanced only, and therefore lazy-loaded.** Reached through `AdvancedPanel`.
 */
export function ExportOptions({ fileName }: { fileName: string }) {
  if (import.meta.env.DEV) countRender("ExportOptions");

  const overrides = useAudioStore(
    (state) => state.tracks.find((t) => t.file.name === fileName)?.exportOverrides
  );
  const trackCount = useAudioStore((state) => state.tracks.length);
  const exportFileType = useAudioStore((state) => state.exportFileType);
  const bitDepth = useAudioStore((state) => state.bitDepth);
  const outputSampleRate = useAudioStore((state) => state.outputSampleRate);
  const joinMode = useAudioStore((state) => state.joinMode);
  const setOverrides = useAudioStore((state) => state.setTrackExportOverrides);
  const copyExportToAllTracks = useAudioStore(
    (state) => state.copyExportToAllTracks
  );

  const set = (patch: ExportOverrides, label: string) =>
    setOverrides(fileName, { ...overrides, ...patch }, { label });

  const format = overrides?.exportFileType ?? exportFileType;
  const overridden = hasExportOverrides(overrides);
  const ignored = joinMode === "all";

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {ignored ? (
              <>
                <b>Join</b> is set to one file for everything, so every track
                exports in the master format. These are kept, not in use.
              </>
            ) : (
              <>
                This track exports with the master settings unless you choose
                otherwise here.
              </>
            )}
          </p>
          <div className="flex shrink-0 gap-1">
            {trackCount > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                title="Give every other track exactly these export choices"
                onClick={() => copyExportToAllTracks(fileName)}
              >
                Copy to all tracks
              </Button>
            )}
            {overridden && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setOverrides(fileName, undefined, { label: "Reset export" })
                }
              >
                Reset to master
              </Button>
            )}
          </div>
        </div>

        <div
          className={`grid grid-cols-1 gap-3 ${ignored ? "opacity-60" : ""}`}
        >
          <FormatField
            value={overrides?.exportFileType}
            inherited={exportFileType}
            onChange={(value) => set({ exportFileType: value }, "Track format")}
          />
          <BitDepthField
            value={overrides?.bitDepth}
            inherited={bitDepth}
            format={format}
            onChange={(value) => set({ bitDepth: value }, "Track bit depth")}
          />
          <SampleRateField
            value={overrides?.outputSampleRate}
            inherited={outputSampleRate}
            format={format}
            onChange={(value) =>
              set({ outputSampleRate: value }, "Track sample rate")
            }
          />
        </div>
      </div>
    </div>
  );
}
