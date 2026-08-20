import { RefObject, useEffect, useRef } from "react";
import { MeterSource, emptyReading } from "@/lib/preview";
import {
  MeterState,
  advanceMeter,
  emptyMeter,
  formatSigned,
  meterIsIdle,
  METER_FLOOR_DB,
} from "@/lib/meter";
import { MeterOrientation, drawMeter, writeMeterReadout } from "@/lib/meter-canvas";
import { joinMeterLoop } from "@/lib/meter-loop";

/**
 * Where a meter pair draws. Every one is optional, so a caller can take the
 * bars without the numbers, or one bar without the other.
 */
export type MeterTargets = {
  /** The dry bar — what enters the signal chain. */
  input: RefObject<HTMLCanvasElement>;
  /** The wet bar — what leaves it. */
  output: RefObject<HTMLCanvasElement>;
  /** The number under the dry bar. */
  inputReadout: RefObject<HTMLElement>;
  /** The number under the wet bar. */
  outputReadout: RefObject<HTMLElement>;
  /**
   * Wet minus dry: what the whole chain is doing to the level, right now.
   *
   * The one number that needs both taps to exist, and the reason there are two
   * meters rather than one.
   */
  differenceReadout: RefObject<HTMLElement>;
};

/**
 * Drives an input and an output meter from one card's preview graph.
 *
 * ## It renders nothing, ever
 *
 * The level changes sixty times a second. If any of it became React state, the
 * card would render sixty times a second and take every other card with it —
 * which is the exact fault ticket 020 removed for `timeupdate`. So the state
 * lives in refs, the loop writes to a canvas and to `textContent`, and React
 * never hears about a single frame.
 *
 * The returned refs are stable for the life of the component, so attaching them
 * costs nothing either.
 *
 * ## One read per frame, shared
 *
 * Both bars come from one `read`, so the two are the same moment of audio.
 * Reading twice would sample the graph at two different times and the pair
 * would no longer be comparable — which is the only thing the pair is for.
 */
export function useMeterPair(
  meters: MeterSource,
  orientation: MeterOrientation,
  ticks = false
): MeterTargets {
  const input = useRef<HTMLCanvasElement>(null);
  const output = useRef<HTMLCanvasElement>(null);
  const inputReadout = useRef<HTMLElement>(null);
  const outputReadout = useRef<HTMLElement>(null);
  const differenceReadout = useRef<HTMLElement>(null);

  // Read every frame and written in place. One object for the life of the card,
  // because sixty objects a second is garbage the collector comes back for in
  // the middle of playback.
  const reading = useRef(emptyReading());
  const inputState = useRef<MeterState>(emptyMeter());
  const outputState = useRef<MeterState>(emptyMeter());

  useEffect(() => {
    const tick = (nowMs: number, dtSec: number) => {
      // False means the card is paused and nothing was read. The frames are
      // still advanced with silence, so the bars fall away instead of freezing
      // where the music stopped.
      if (!meters.read(reading.current)) {
        reading.current.input.rms = 0;
        reading.current.input.peak = 0;
        reading.current.output.rms = 0;
        reading.current.output.peak = 0;
      }

      const wasIdle = meterIsIdle(
        [inputState.current, outputState.current],
        nowMs
      );

      inputState.current = advanceMeter(
        inputState.current,
        reading.current.input,
        nowMs,
        dtSec
      );
      outputState.current = advanceMeter(
        outputState.current,
        reading.current.output,
        nowMs,
        dtSec
      );

      // Idle before and idle after means the picture cannot have changed. This
      // is what makes a page of paused cards cost nothing.
      if (
        wasIdle &&
        meterIsIdle([inputState.current, outputState.current], nowMs)
      ) {
        return;
      }

      if (input.current) {
        drawMeter(input.current, inputState.current, nowMs, { orientation, ticks });
      }
      if (output.current) {
        drawMeter(output.current, outputState.current, nowMs, { orientation, ticks });
      }
      if (inputReadout.current) {
        writeMeterReadout(inputReadout.current, inputState.current);
      }
      if (outputReadout.current) {
        writeMeterReadout(outputReadout.current, outputState.current);
      }
      if (differenceReadout.current) {
        writeDifference(
          differenceReadout.current,
          inputState.current,
          outputState.current
        );
      }
    };

    return joinMeterLoop(tick);
  }, [meters, orientation, ticks]);

  return { input, output, inputReadout, outputReadout, differenceReadout };
}

/**
 * What the chain is doing to the level, as one signed number.
 *
 * Silence has no answer — a chain that is fed nothing changes nothing by no
 * amount — so it reads as a dash rather than as `+0.0`, which would claim the
 * chain was measured and found to be flat.
 */
function writeDifference(
  element: HTMLElement,
  input: MeterState,
  output: MeterState
): void {
  const text =
    input.db <= METER_FLOOR_DB ? "—" : formatSigned(output.db - input.db);

  if (element.textContent !== text) element.textContent = text;
}
