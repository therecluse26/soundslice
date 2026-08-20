import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioStore } from "@/stores/audio-store";
import { AudioService } from "@/lib/audio-service";
import { BIT_DEPTHS, BitDepth, hasBitDepth } from "@/lib/output-format";
import { EXPORT_SAMPLE_RATES } from "@/lib/audio-format";
import { countRender } from "@/lib/render-count";

/** What the sample rate select writes when the user picks "Same as source". */
const SOURCE_RATE = "source";

/**
 * Bit depth and sample rate. Advanced view only.
 *
 * The format select itself stays in the master toolbar, where it has always
 * been — Advanced view adds two rows to it rather than a second place to choose
 * a format. These two are the rows Simple view has no question for.
 *
 * Both are **master defaults**, like the loudness target beside them: one depth
 * and one rate for the whole export. Per-track overrides are ticket 009's shape
 * and no feature uses them yet.
 *
 * **Advanced only, and therefore lazy-loaded.** Reached through `AdvancedPanel`,
 * which `AudioEditor` imports dynamically, so a Simple view user downloads none
 * of it. Standing rule 6.
 */
export function ExportOptions() {
  if (import.meta.env.DEV) countRender("ExportOptions");

  const exportFileType = useAudioStore((state) => state.exportFileType);
  const bitDepth = useAudioStore((state) => state.bitDepth);
  const setBitDepth = useAudioStore((state) => state.setBitDepth);
  const outputSampleRate = useAudioStore((state) => state.outputSampleRate);
  const setOutputSampleRate = useAudioStore(
    (state) => state.setOutputSampleRate
  );

  const depthApplies = hasBitDepth(exportFileType);

  // What the encoder will really use. MP3 takes nine rates and Opus takes five,
  // so the answer is not always the question — and a control that hides that is
  // a control that lies. "Same as source" cannot be checked here, because only
  // the file knows its own rate.
  const actual =
    outputSampleRate === null
      ? null
      : AudioService.exportSampleRate(outputSampleRate, {
          exportFileType,
          outputSampleRate,
        });
  const snapped = actual !== null && actual !== outputSampleRate;

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-2">
        <Label>Bit depth</Label>

        <Select
          disabled={!depthApplies}
          value={bitDepth.toString()}
          onValueChange={(value) =>
            setBitDepth(Number(value) as BitDepth)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BIT_DEPTHS.map((depth) => (
              <SelectItem key={`depth_${depth}`} value={depth.toString()}>
                {depth}-bit
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          {depthApplies ? (
            <>
              How many bits each sample is stored in. 24-bit keeps more of the
              quiet detail and makes the file half as large again.
            </>
          ) : (
            <>
              Not in use. MP3 and Opus store frequencies, not samples, so they
              have no bit depth. Choose WAV or FLAC to set one.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Sample rate</Label>

        <Select
          value={outputSampleRate === null ? SOURCE_RATE : outputSampleRate.toString()}
          onValueChange={(value) =>
            setOutputSampleRate(value === SOURCE_RATE ? null : Number(value))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SOURCE_RATE}>Same as source</SelectItem>
            {EXPORT_SAMPLE_RATES.map((rate) => (
              <SelectItem key={`rate_${rate}`} value={rate.toString()}>
                {(rate / 1000).toFixed(3).replace(/\.?0+$/, "")} kHz
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          {snapped ? (
            <>
              {exportFileType.toUpperCase()} does not encode at{" "}
              {outputSampleRate} Hz, so this export uses <b>{actual} Hz</b>. The
              file is resampled once, on the way in.
            </>
          ) : (
            <>
              How many samples a second the file holds. Leave it at{" "}
              <b>Same as source</b> unless you need a smaller file or a rate
              something else demands.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
