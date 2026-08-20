import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EqBand } from "@/lib/edit-stack";
import {
  EQ_Q_RANGE,
  clampBand,
  clampTo,
  eqBandAtPoint,
  eqValuesAtPoint,
  formatDb,
} from "@/lib/signal-chain";
import { drawEq } from "@/lib/curve-canvas";

/**
 * The EQ, as a curve you drag.
 *
 * One dot per band. Drag it sideways for frequency and up and down for gain.
 * The line is the **real** response of the filters that will be built — see
 * `eqResponseDb`, which is `BiquadFilterNode`'s own formula — so what the curve
 * shows is what the audio does.
 *
 * ## The gestures
 *
 * | Gesture | What it does |
 * |---|---|
 * | drag a dot | frequency and gain, together |
 * | wheel over a dot | the band's Q — how wide it is |
 * | double-click a dot | back to 0 dB, leaving frequency alone |
 *
 * ## The curve is drawn at 48 kHz
 *
 * A filter's response depends on the sample rate, and a track's rate is not
 * known until it is decoded. The two differ only in the top octave, by a
 * fraction of a decibel, and drawing a curve per track would cost a decode to
 * fix something nobody can see. `CURVE_SAMPLE_RATE` is where that choice lives.
 */
export function EqEditor({
  bands,
  onChange,
  onCommit,
}: {
  bands: EqBand[];
  /** A new set of bands, mid-gesture. */
  onChange: (bands: EqBand[]) => void;
  /** The gesture ended. Closes the undo entry. */
  onCommit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(-1);
  const dragging = useRef(-1);

  // Read by listeners that outlive a render — the resize observer and the wheel
  // handler are both attached once and must never see a stale band list. Set
  // during render, which is the same fix the region overlays needed.
  const latest = useRef({ bands, onChange, onCommit, active });
  latest.current = { bands, onChange, onCommit, active };

  // `useLayoutEffect`, not `useEffect`: the canvas is painted before the browser
  // shows the frame, so opening the block cannot flash an empty box.
  useLayoutEffect(() => {
    if (canvas.current) drawEq(canvas.current, bands, active);
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    // An accordion opens from a height of zero. A canvas that measured itself
    // once would keep the size it had while it was closed, which is none.
    const observer = new ResizeObserver(() =>
      drawEq(element, latest.current.bands, latest.current.active)
    );
    observer.observe(element);

    const onWheel = (event: WheelEvent) => {
      const index = bandAt(element, event, latest.current.bands);
      if (index < 0) return;

      // Only once a band is actually under the pointer, so the page still
      // scrolls when the wheel is used over the empty part of the curve.
      event.preventDefault();

      const band = latest.current.bands[index];
      const q = clampTo(band.q * (event.deltaY > 0 ? 1 / 1.15 : 1.15), EQ_Q_RANGE);

      latest.current.onChange(
        latest.current.bands.map((one, at) => (at === index ? { ...one, q } : one))
      );
      latest.current.onCommit();
    };

    // Not passive: `preventDefault` is the whole point, and React attaches its
    // own wheel listeners passively.
    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const index = bandAt(event.currentTarget, event.nativeEvent, bands);
    if (index < 0) return;

    dragging.current = index;
    setActive(index);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (dragging.current < 0) {
      const hover = eqBandAtPoint(bands, x, y, rect.width, rect.height);
      if (hover !== active) setActive(hover);
      return;
    }

    const { hz, db } = eqValuesAtPoint(x, y, rect.width, rect.height);
    const index = dragging.current;

    onChange(
      bands.map((band, at) => (at === index ? clampBand({ ...band, hz, db }) : band))
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging.current < 0) return;

    dragging.current = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit();
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const index = bandAt(event.currentTarget, event.nativeEvent, bands);
    if (index < 0) return;

    onChange(bands.map((band, at) => (at === index ? { ...band, db: 0 } : band)));
    onCommit();
  };

  const shown = active >= 0 ? active : 1;
  const band = bands[shown];

  return (
    <div>
      <canvas
        ref={canvas}
        className="h-40 w-full cursor-pointer touch-none rounded border border-border bg-muted/20"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => dragging.current < 0 && setActive(-1)}
        onDoubleClick={onDoubleClick}
        aria-label="Equalizer curve"
      />

      <div className="mt-1.5 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">
          Drag a dot. Wheel over it for width. Double-click it for 0 dB.
        </span>
        {band && (
          <code className="text-primary">
            {formatHz(band.hz)} · {formatDb(band.db)} · Q {band.q.toFixed(2)}
          </code>
        )}
      </div>
    </div>
  );
}

/** The band under a pointer event, in the canvas's own CSS pixels. */
function bandAt(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number },
  bands: readonly EqBand[]
): number {
  const rect = canvas.getBoundingClientRect();

  return eqBandAtPoint(
    bands,
    event.clientX - rect.left,
    event.clientY - rect.top,
    rect.width,
    rect.height
  );
}

/** `440 Hz`, `1.20 kHz`. Three significant figures, the way a filter is read. */
function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${Math.round(hz)} Hz`;
}
