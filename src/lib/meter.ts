/**
 * The maths behind a meter. Plain functions, no Web Audio, no canvas.
 *
 * `dsp.ts`'s rule, applied one file over: the moment a module imports an
 * `AnalyserNode` its tests need a browser. So the ballistics, the scale and the
 * formatting live here where Vitest reads them under Node, and `preview.ts`
 * owns the two taps that produce the numbers.
 *
 * ## What a meter shows
 *
 * Two things at once, because one is not enough:
 *
 * - **The bar** is RMS — how loud it sounds. It moves the way a needle moves.
 * - **The line** is the peak — the loudest single sample in the last moment. It
 *   is what clips, and RMS never shows it.
 *
 * A meter that showed only RMS would sit at a comfortable two-thirds while the
 * signal clipped. A meter that showed only peak would twitch and tell you
 * nothing about level. Both, together, is what every DAW draws.
 */

import { gainToDb } from "./dsp";

/**
 * The quietest level the meter draws, in dBFS.
 *
 * Below it the bar is empty. −60 dB is roughly the noise floor of a decent
 * recording, so a silent passage reads empty rather than reading "very quiet"
 * and inviting the user to squint at it.
 */
export const METER_FLOOR_DB = -60;

/**
 * How fast the bar falls, in dB per second.
 *
 * The bar rises instantly and falls slowly. That asymmetry is the whole point
 * of meter ballistics: a transient that lasted 3 ms is drawn for long enough to
 * see, and the eye is not asked to track a value that changes 60 times a
 * second.
 *
 * 20 dB/s is the digital-peak-meter convention. At that rate a full-scale hit
 * takes three seconds to reach the floor.
 */
export const METER_DECAY_DB_PER_SEC = 20;

/**
 * How long the peak line stays where it was put, in milliseconds.
 *
 * One second. Long enough to read a number off it, short enough that it tracks
 * the music rather than the loudest moment of the whole track.
 */
export const PEAK_HOLD_MS = 1000;

/**
 * How long the clip warning stays lit, in milliseconds.
 *
 * Far longer than the peak hold. A single clipped sample is a real fault and
 * the user may have been looking elsewhere when it happened.
 */
export const CLIP_HOLD_MS = 2000;

/** One read of one tap. Linear amplitude, not decibels. */
export type MeterFrame = {
  /** Root mean square over the window. What the bar shows. */
  rms: number;
  /** Largest absolute sample in the window. What the line shows. */
  peak: number;
};

/** What a meter is drawing right now. Decibels, because that is the scale. */
export type MeterState = {
  /** The bar, after decay. */
  db: number;
  /** The held peak line. */
  peakDb: number;
  /** Context time the peak line is released at, in milliseconds. */
  peakUntilMs: number;
  /** Context time the clip warning goes out at, in milliseconds. */
  clipUntilMs: number;
};

/** A meter showing silence and holding nothing. */
export function emptyMeter(): MeterState {
  return {
    db: METER_FLOOR_DB,
    peakDb: METER_FLOOR_DB,
    peakUntilMs: 0,
    clipUntilMs: 0,
  };
}

/**
 * A linear amplitude as decibels, never below the floor.
 *
 * `gainToDb(0)` is −Infinity, which cannot be drawn and cannot be subtracted
 * from. Every value the meter carries is clamped here, once, so nothing
 * downstream has to answer for infinity.
 */
export function levelDb(linear: number): number {
  return Math.max(METER_FLOOR_DB, gainToDb(linear));
}

/**
 * Where a level sits on the meter, from 0 at the floor to 1 at full scale.
 *
 * **Linear in decibels.** −30 dB is halfway up. A warped scale gives more room
 * near the top, where mixing decisions are made, and it makes the meter lie
 * about the distance between two numbers. This one can be read with a ruler.
 *
 * Above full scale the answer is still 1 — the bar is full and the clip warning
 * is what says how far past it went.
 */
export function meterFraction(db: number): number {
  if (db <= METER_FLOOR_DB) return 0;
  if (db >= 0) return 1;
  return (db - METER_FLOOR_DB) / -METER_FLOOR_DB;
}

/**
 * The meter one frame later.
 *
 * Attack is instant and decay is timed, so a rise is never missed and a fall is
 * always readable. `dtSec` is real elapsed time rather than an assumed frame
 * length, because a background tab, a slow paint or a 120 Hz screen all change
 * it — and a decay measured in frames would fall at a different speed on each.
 *
 * Pure: it returns a new state and reads no clock of its own.
 */
export function advanceMeter(
  state: MeterState,
  frame: MeterFrame,
  nowMs: number,
  dtSec: number
): MeterState {
  const rmsDb = levelDb(frame.rms);
  const peakDb = levelDb(frame.peak);

  const decayed = Math.max(
    METER_FLOOR_DB,
    state.db - METER_DECAY_DB_PER_SEC * Math.max(0, dtSec)
  );

  const held = nowMs < state.peakUntilMs ? state.peakDb : METER_FLOOR_DB;

  return {
    db: Math.max(rmsDb, decayed),
    peakDb: Math.max(peakDb, held),
    peakUntilMs: peakDb >= held ? nowMs + PEAK_HOLD_MS : state.peakUntilMs,
    // A sample at or past full scale is a clip. `>= 1` and not `> 1`: a decoder
    // that hit the rail reports exactly 1.0, and that is the case worth warning
    // about.
    clipUntilMs: frame.peak >= 1 ? nowMs + CLIP_HOLD_MS : state.clipUntilMs,
  };
}

/** True while the clip warning should be lit. */
export function isClipped(state: MeterState, nowMs: number): boolean {
  return nowMs < state.clipUntilMs;
}

/**
 * A level as text, for the number beside the meter.
 *
 * The floor reads as an infinity sign rather than as "−60.0 dB", because −60 is
 * where the meter stops looking and not where the audio stopped.
 */
export function formatMeterDb(db: number): string {
  return db <= METER_FLOOR_DB ? "−∞" : formatSigned(db);
}

/**
 * A signed level with a **real** minus sign, U+2212, and no floor.
 *
 * What the difference between two meters is written with. A difference of −60
 * is a real number and must not read as "−∞" the way a level of −60 does: the
 * chain pulled the signal down by sixty decibels, which is a fact, not an
 * absence.
 */
export function formatSigned(db: number): string {
  const rounded = Math.abs(db) < 0.05 ? 0 : db;
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * True when both taps have been silent long enough to stop drawing.
 *
 * The meter loop asks this so a page with a paused track costs no frames.
 * Standing rule 7 is about the audio thread; this is the same care applied to
 * the paint thread.
 */
export function meterIsIdle(states: readonly MeterState[], nowMs: number): boolean {
  return states.every(
    (state) =>
      state.db <= METER_FLOOR_DB &&
      state.peakDb <= METER_FLOOR_DB &&
      nowMs >= state.clipUntilMs
  );
}
