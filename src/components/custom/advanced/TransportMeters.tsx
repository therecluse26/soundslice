import { MeterSource } from "@/lib/preview";
import { useMeterPair } from "@/hooks/useMeterPair";

/**
 * The small input and output pair, beside the play button.
 *
 * The same two taps the Sound section's tall meters read, drawn small enough to
 * live on the transport row. It answers one question without opening anything:
 * **is the chain making this louder or quieter, and is it about to clip?**
 *
 * A default export, because `AudioEditor` reaches it through `React.lazy`. It
 * is Advanced view only — Simple view has no chain to compare against and
 * ticket 010's rule is that Simple gains no new control.
 */
export default function TransportMeters({ meters }: { meters: MeterSource }) {
  const targets = useMeterPair(meters, "horizontal");

  return (
    <div
      className="flex shrink-0 flex-col justify-center gap-1"
      title="Input and output level. Input is the region before the track's chain; output is what you hear."
    >
      <Row label="in" canvas={targets.input} />
      <Row label="out" canvas={targets.output} />
    </div>
  );
}

function Row({
  label,
  canvas,
}: {
  label: string;
  canvas: React.RefObject<HTMLCanvasElement>;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-5 shrink-0 text-[9px] uppercase leading-none text-muted-foreground">
        {label}
      </span>
      <canvas
        ref={canvas}
        className="h-1.5 w-16 rounded-sm border border-border"
        aria-label={`${label} level`}
      />
    </div>
  );
}
