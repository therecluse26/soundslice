import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioStore } from "@/stores/audio-store";
import { JOIN_MODES, JoinMode } from "@/lib/master-defaults";
import { countRender } from "@/lib/render-count";
import { BitDepthField, SampleRateField } from "./ExportFields";
import { ProjectFile } from "./ProjectFile";

/** What each join mode is called in the select. */
const JOIN_LABEL: Record<JoinMode, string> = {
  separate: "Separate files",
  track: "One file per track",
  all: "One file for everything",
};

/**
 * The master export choices Simple view has no question for: **Join**, bit
 * depth and sample rate. Advanced view only.
 *
 * ## Why they are on the master toolbar
 *
 * They are master defaults — what every track exports with unless it says
 * otherwise. Bit depth and rate used to sit inside every track card's Export
 * section while editing the master, so changing one card's select changed every
 * card. Ticket 033 gave a card its own overrides, and these went to where the
 * other master defaults already were.
 *
 * ## Join
 *
 * - **Separate files** — one file per region.
 * - **One file per track** — a track's regions laid end to end, in the order
 *   its join strip gives, with the crossfades it gives. The track's stack runs
 *   **once** over the joined audio.
 * - **One file for everything** — every track's join, through that track's
 *   own stack, laid end to end in card order. One file has one format, so this
 *   mode uses the master format and every track's export overrides are ignored.
 *   Ticket 034.
 *
 * **Advanced only, and therefore lazy-loaded.** `MasterToolbar` is in Simple
 * view's bundle, so this is reached through a dynamic import and needs a default
 * export. Standing rule 6.
 */
export default function MasterExportOptions() {
  if (import.meta.env.DEV) countRender("MasterExportOptions");

  const joinMode = useAudioStore((state) => state.joinMode);
  const setJoinMode = useAudioStore((state) => state.setJoinMode);
  const exportFileType = useAudioStore((state) => state.exportFileType);
  const bitDepth = useAudioStore((state) => state.bitDepth);
  const setBitDepth = useAudioStore((state) => state.setBitDepth);
  const outputSampleRate = useAudioStore((state) => state.outputSampleRate);
  const setOutputSampleRate = useAudioStore(
    (state) => state.setOutputSampleRate
  );

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-normal text-muted-foreground">Join</Label>
        <Select
          value={joinMode}
          onValueChange={(value) => setJoinMode(value as JoinMode)}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOIN_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {JOIN_LABEL[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <BitDepthField
          value={bitDepth}
          format={exportFileType}
          onChange={(depth) => depth && setBitDepth(depth)}
        />
        <SampleRateField
          value={outputSampleRate}
          format={exportFileType}
          onChange={(rate) => rate !== undefined && setOutputSampleRate(rate)}
        />
      </div>

      <ProjectFile />
    </div>
  );
}
