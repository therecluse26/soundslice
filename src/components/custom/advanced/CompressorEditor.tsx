import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Operation } from "@/lib/edit-stack";
import {
  COMPRESSOR_RANGES,
  clampCompressor,
  clampTo,
  compressorFraction,
  formatDb,
  formatRatio,
  fractionCompressorDb,
  ratioForOutputAtFullScale,
} from "@/lib/signal-chain";
import { compressorHandles, drawCompressor } from "@/lib/curve-canvas";
import { ToolSlider } from "./ToolControls";

type Compressor = Extract<Operation, { op: "compressor" }>;
type Handle = "threshold" | "ratio";

/** How close a pointer has to be to a handle to grab it, in CSS pixels. */
const HANDLE_RADIUS_PX = 18;

/**
 * The compressor, as the curve it applies.
 *
 * The dashed diagonal is what no compression looks like. The solid line is what
 * this compressor does, and the gap between them at any point is how much it
 * pulls that level down. Two handles move the line:
 *
 * | Handle | Where | What it sets |
 * |---|---|---|
 * | on the diagonal | where the line leaves it | the threshold |
 * | at the right edge | the top of the curve | the ratio |
 *
 * Knee, attack and release stay sliders. They shape *when* the curve is
 * reached, not what it looks like, so a handle on the line could not express
 * them honestly.
 *
 * ## There is no moving dot on this curve
 *
 * The two chain meters tap the ends of the **whole** chain, not the ends of
 * this block. Anything before the compressor — an EQ, most of all — means the
 * level arriving here is not the level the input meter shows, so a dot placed
 * from it would sit in the wrong place and be believed. The honest live numbers
 * are the two meters and the difference between them.
 */
export function CompressorEditor({
  operation,
  onChange,
  onCommit,
}: {
  operation: Compressor;
  onChange: (operation: Compressor) => void;
  onCommit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState<Handle | null>(null);
  const dragging = useRef<Handle | null>(null);

  const latest = useRef({ operation, active });
  latest.current = { operation, active };

  useLayoutEffect(() => {
    if (canvas.current) drawCompressor(canvas.current, operation, active);
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const observer = new ResizeObserver(() =>
      drawCompressor(element, latest.current.operation, latest.current.active)
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const handle = handleAt(event.currentTarget, event.nativeEvent, operation);
    if (!handle) return;

    dragging.current = handle;
    setActive(handle);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) {
      const hover = handleAt(event.currentTarget, event.nativeEvent, operation);
      if (hover !== active) setActive(hover);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height;

    if (dragging.current === "threshold") {
      // The threshold handle rides the diagonal, so only its position along the
      // axis matters and the vertical part of the drag is ignored.
      onChange(
        clampCompressor({
          ...operation,
          thresholdDb: clampTo(
            fractionCompressorDb(x),
            COMPRESSOR_RANGES.thresholdDb
          ),
        })
      );
      return;
    }

    onChange(
      clampCompressor({
        ...operation,
        ratio: ratioForOutputAtFullScale(
          operation.thresholdDb,
          fractionCompressorDb(y)
        ),
      })
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;

    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit();
  };

  const change = (patch: Partial<Compressor>) =>
    onChange(clampCompressor({ ...operation, ...patch }));

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <canvas
        ref={canvas}
        className="h-40 w-full shrink-0 cursor-pointer touch-none rounded border border-border bg-muted/20 sm:w-40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => !dragging.current && setActive(null)}
        aria-label="Compressor curve"
      />

      <div className="flex flex-1 flex-col gap-2">
        <ToolSlider
          label="Threshold"
          display={formatDb(operation.thresholdDb)}
          value={operation.thresholdDb}
          range={COMPRESSOR_RANGES.thresholdDb}
          onChange={(thresholdDb) => change({ thresholdDb })}
          onCommit={onCommit}
        />
        <ToolSlider
          label="Ratio"
          display={formatRatio(operation.ratio)}
          value={operation.ratio}
          range={COMPRESSOR_RANGES.ratio}
          onChange={(ratio) => change({ ratio })}
          onCommit={onCommit}
        />
        <ToolSlider
          label="Knee"
          display={`${operation.kneeDb.toFixed(1)} dB`}
          value={operation.kneeDb}
          range={COMPRESSOR_RANGES.kneeDb}
          onChange={(kneeDb) => change({ kneeDb })}
          onCommit={onCommit}
        />
        <ToolSlider
          label="Attack"
          display={`${operation.attackMs.toFixed(0)} ms`}
          value={operation.attackMs}
          range={COMPRESSOR_RANGES.attackMs}
          onChange={(attackMs) => change({ attackMs })}
          onCommit={onCommit}
        />
        <ToolSlider
          label="Release"
          display={`${operation.releaseMs.toFixed(0)} ms`}
          value={operation.releaseMs}
          range={COMPRESSOR_RANGES.releaseMs}
          onChange={(releaseMs) => change({ releaseMs })}
          onCommit={onCommit}
        />

        <p className="text-xs text-muted-foreground">
          Drag the dot on the dashed line to move the threshold. Drag the dot at
          the right edge to change the ratio. The makeup gain this node adds on
          its own is taken back off, so the ratio is the only thing that changes
          the level.
        </p>
      </div>
    </div>
  );
}

/** Which handle a pointer event grabs, or `null`. */
function handleAt(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number },
  operation: Compressor
): Handle | null {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const handles = compressorHandles(operation, rect.width, rect.height);

  const toThreshold = Math.hypot(x - handles.threshold.x, y - handles.threshold.y);
  const toRatio = Math.hypot(x - handles.ratio.x, y - handles.ratio.y);

  if (toThreshold > HANDLE_RADIUS_PX && toRatio > HANDLE_RADIUS_PX) return null;
  return toThreshold <= toRatio ? "threshold" : "ratio";
}

