import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AudioService } from "@/lib/audio-service";
import {
  ADVANCED_FORMATS,
  BIT_DEPTHS,
  BitDepth,
  FORMAT_LABEL,
  OutputFormat,
  hasBitDepth,
  needsWebCodecs,
} from "@/lib/output-format";
import { EXPORT_SAMPLE_RATES } from "@/lib/audio-format";
import { canEncodeOpus } from "@/lib/encode-capabilities";

/**
 * The three export rows — format, bit depth, sample rate — drawn once and used
 * twice: on the master toolbar for the master defaults, and on a track card for
 * that track's overrides. Ticket 033.
 *
 * One component per row, so the two places cannot drift apart in wording or in
 * the rates they offer.
 *
 * **Inheriting.** When `inherited` is given, the row gains a first option that
 * reads "Master (…)" and means *no override*. Choosing it calls `onChange` with
 * `undefined`. That is ticket 003's override model drawn as a select: a track
 * either says what it wants or it inherits, with nothing in between.
 */

/** What the select writes for "no override". Never a real value. */
const INHERIT = "inherit";

/** What the sample rate select writes for "Same as source". */
const SOURCE_RATE = "source";

function rateLabel(rate: number | null): string {
  if (rate === null) return "Same as source";
  return `${(rate / 1000).toFixed(3).replace(/\.?0+$/, "")} kHz`;
}

/** Which formats this browser can write in Advanced view. Opus may be missing. */
export function useAdvancedFormats(current?: OutputFormat): OutputFormat[] {
  const [opus, setOpus] = useState(false);

  useEffect(() => {
    let live = true;
    canEncodeOpus().then((can) => {
      if (live) setOpus(can);
    });
    return () => {
      live = false;
    };
  }, []);

  return ADVANCED_FORMATS.filter(
    (format) => !needsWebCodecs(format) || opus || format === current
  );
}

export function FormatField({
  value,
  inherited,
  onChange,
}: {
  value: OutputFormat | undefined;
  inherited?: OutputFormat;
  onChange: (format: OutputFormat | undefined) => void;
}) {
  const formats = useAdvancedFormats(value);

  return (
    <Field label="Format" overridden={inherited !== undefined && value !== undefined}>
      <Select
        value={value ?? INHERIT}
        onValueChange={(next) =>
          onChange(next === INHERIT ? undefined : (next as OutputFormat))
        }
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {inherited !== undefined && (
            <SelectItem value={INHERIT}>
              Master ({FORMAT_LABEL[inherited]})
            </SelectItem>
          )}
          {formats.map((format) => (
            <SelectItem key={format} value={format}>
              {FORMAT_LABEL[format]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function BitDepthField({
  value,
  inherited,
  format,
  onChange,
}: {
  value: BitDepth | undefined;
  inherited?: BitDepth;
  /** The format this depth would be written in. MP3 and Opus have none. */
  format: OutputFormat;
  onChange: (depth: BitDepth | undefined) => void;
}) {
  const applies = hasBitDepth(format);

  return (
    <Field
      label="Bit depth"
      overridden={inherited !== undefined && value !== undefined}
      note={
        applies
          ? undefined
          : `Not in use: ${FORMAT_LABEL[format]} stores frequencies, not samples.`
      }
    >
      <Select
        disabled={!applies}
        value={value === undefined ? INHERIT : value.toString()}
        onValueChange={(next) =>
          onChange(next === INHERIT ? undefined : (Number(next) as BitDepth))
        }
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {inherited !== undefined && (
            <SelectItem value={INHERIT}>Master ({inherited}-bit)</SelectItem>
          )}
          {BIT_DEPTHS.map((depth) => (
            <SelectItem key={depth} value={depth.toString()}>
              {depth}-bit
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function SampleRateField({
  value,
  inherited,
  format,
  onChange,
}: {
  /** `null` is "Same as source". `undefined` is "no override". */
  value: number | null | undefined;
  inherited?: number | null;
  format: OutputFormat;
  onChange: (rate: number | null | undefined) => void;
}) {
  const asked = value === undefined ? inherited ?? null : value;

  // What the encoder will really use. MP3 takes nine rates and Opus takes five,
  // so the answer is not always the question — and a control that hides that is
  // a control that lies. "Same as source" cannot be checked here, because only
  // the file knows its own rate.
  const actual =
    asked === null
      ? null
      : AudioService.exportSampleRate(asked, {
          exportFileType: format,
          outputSampleRate: asked,
        });

  return (
    <Field
      label="Sample rate"
      overridden={inherited !== undefined && value !== undefined}
      note={
        actual !== null && actual !== asked
          ? `${FORMAT_LABEL[format]} does not encode at ${asked} Hz, so this uses ${actual} Hz.`
          : undefined
      }
    >
      <Select
        value={
          value === undefined
            ? INHERIT
            : value === null
              ? SOURCE_RATE
              : value.toString()
        }
        onValueChange={(next) =>
          onChange(
            next === INHERIT
              ? undefined
              : next === SOURCE_RATE
                ? null
                : Number(next)
          )
        }
      >
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {inherited !== undefined && (
            <SelectItem value={INHERIT}>Master ({rateLabel(inherited)})</SelectItem>
          )}
          <SelectItem value={SOURCE_RATE}>Same as source</SelectItem>
          {EXPORT_SAMPLE_RATES.map((rate) => (
            <SelectItem key={rate} value={rate.toString()}>
              {rateLabel(rate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Field({
  label,
  overridden,
  note,
  children,
}: {
  label: string;
  /** True when a track sets this itself. Marked, so an override is visible. */
  overridden: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
        {label}
        {overridden && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-primary"
            title="This track sets its own"
          />
        )}
      </Label>
      {children}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
