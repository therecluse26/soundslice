/**
 * Transients — where a sound starts.
 *
 * A **transient** is a sudden rise in level. `snap` is the region tool that
 * makes a dragged region edge land on one: a magnet on a drag, not a button, and
 * it makes no regions of its own. Cutting one region per transient is a
 * different feature — "split at transients" — and it is deliberately not here.
 *
 * Plain maths over `Float32Array`, so Vitest reads it under Node. Caching,
 * decoding and the drag itself live elsewhere.
 *
 * ## There is no standard to match
 *
 * Loudness had ITU-R BS.1770 and a reference implementation to check against.
 * Onset detection has neither: energy rise, high-frequency content and spectral
 * flux are all defensible and none of them is *the* answer.
 *
 * This is **energy rise**, and the reason is cost. The magnet has to be right on
 * the first drag, so detection runs once over the whole track — 45 minutes of it
 * — and a spectral method means an FFT per hop. A broadband envelope is one pass
 * over the samples and it finds the thing a user is pointing at: a drum hit, the
 * start of a word, the top of a breath.
 *
 * Three rules turn a rise into an onset:
 *
 * 1. **The rise must be big enough** — `minRiseDb` between two hops.
 * 2. **The result must be loud enough** — above `floorDb`, so noise wandering
 *    about in a quiet room does not register as a hit.
 * 3. **Two onsets cannot be too close** — `minSpacingMs`, keeping the strongest
 *    of a cluster. A single drum hit rises over several hops and is one onset.
 */

import { rmsDbWindows } from "./dsp";

export type TransientSettings = {
  /** How much louder one hop must be than the last, in dB. */
  minRiseDb: number;
  /** How loud the hop itself must be, in dBFS. */
  floorDb: number;
  /** The closest two onsets may be, in milliseconds. */
  minSpacingMs: number;
};

/**
 * Where detection starts.
 *
 * 6 dB is a doubling of amplitude, which is what an attack does and what steady
 * material does not. −50 dBFS is under anything anyone would call a sound and
 * over the noise floor of a normal recording. 50 ms is faster than a drummer can
 * play the same drum twice, so it clusters an attack without merging two hits.
 */
export const TRANSIENT_DEFAULTS: TransientSettings = {
  minRiseDb: 6,
  floorDb: -50,
  minSpacingMs: 50,
};

/**
 * The hop the level is measured over, in milliseconds.
 *
 * 10 ms is the resolution of the search. The answer is then refined to a single
 * sample inside the winning hop, so the magnet lands on the attack rather than
 * up to 10 ms before it — see `refineOnset`.
 */
export const TRANSIENT_WINDOW_MS = 10;

/**
 * How far from a transient the magnet still pulls, in **pixels**.
 *
 * Pixels, not seconds, so it scales with zoom. Zoomed out, a whole bar is a few
 * pixels and a magnet measured in seconds would grab a region from the other
 * side of the screen; zoomed in, it would never reach anything. Every other
 * editor works in pixels for the same reason.
 */
export const SNAP_RADIUS_PX = 12;

/** How many samples one detection hop holds at this rate. */
export function transientWindowSamples(sampleRate: number): number {
  return Math.max(1, Math.round((sampleRate * TRANSIENT_WINDOW_MS) / 1000));
}

/**
 * Every transient in this audio, in seconds, ascending.
 *
 * The one-call answer, for a caller that already holds every sample.
 */
export function detectTransients(
  channels: Float32Array[],
  sampleRate: number,
  settings: TransientSettings = TRANSIENT_DEFAULTS
): number[] {
  const windowSamples = transientWindowSamples(sampleRate);
  const levels = rmsDbWindows(channels, windowSamples);

  return onsetsFromLevels(levels, settings).map((window) =>
    refineOnset(channels, levels, window, windowSamples, sampleRate)
  );
}

/**
 * The hops a sound starts in, as window indices.
 *
 * Separate from the sample scan so a test can drive it with a level array it
 * wrote by hand, and so a chunked caller can measure levels in pieces and find
 * onsets once over the whole of them.
 */
export function onsetsFromLevels(
  levels: Float32Array,
  settings: TransientSettings = TRANSIENT_DEFAULTS
): number[] {
  const spacingWindows = Math.max(
    1,
    Math.round(settings.minSpacingMs / TRANSIENT_WINDOW_MS)
  );

  const found: number[] = [];
  let lastRise = -Infinity;

  for (let window = 1; window < levels.length; window++) {
    const level = levels[window];
    if (!(level > settings.floorDb)) continue;

    const rise = level - levels[window - 1];
    if (!(rise >= settings.minRiseDb)) continue;

    const previous = found[found.length - 1];

    if (previous !== undefined && window - previous < spacingWindows) {
      // Same attack, seen again. Keep whichever hop rose hardest, so a slow
      // swell does not drag the mark past the moment the sound began.
      if (rise > lastRise) {
        found[found.length - 1] = window;
        lastRise = rise;
      }
      continue;
    }

    found.push(window);
    lastRise = rise;
  }

  return found;
}

/**
 * The exact sample the sound starts on, inside a hop that has been chosen.
 *
 * A 10 ms hop is not good enough to cut on — a region edge 10 ms early keeps the
 * tail of whatever came before. This walks the winning hop and returns the first
 * sample that is clearly part of the new sound: twice the level the previous hop
 * held, or a quarter of this hop's own peak, whichever is louder.
 *
 * Falls back to the start of the hop when nothing crosses, which cannot happen
 * for a real rise and costs nothing to guard.
 */
export function refineOnset(
  channels: Float32Array[],
  levels: Float32Array,
  window: number,
  windowSamples: number,
  sampleRate: number
): number {
  const from = window * windowSamples;
  const to = Math.min(from + windowSamples, channels[0]?.length ?? 0);

  let peak = 0;
  for (const samples of channels) {
    for (let i = from; i < to; i++) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }

  const before = levels[window - 1];
  const previousAmplitude = before > -Infinity ? Math.pow(10, before / 20) : 0;
  const threshold = Math.max(previousAmplitude * 2, peak * 0.25);

  for (let i = from; i < to; i++) {
    for (const samples of channels) {
      if (Math.abs(samples[i]) >= threshold) return i / sampleRate;
    }
  }

  return from / sampleRate;
}

/**
 * The transient nearest `at`, or `null` when none is within `radiusSec`.
 *
 * A binary search, because this runs on **every frame of a drag** and a
 * 45-minute track holds thousands of transients. A linear scan would be the one
 * thing on the drag path that grows with the length of the file.
 *
 * `times` must be ascending, which is what `detectTransients` returns.
 */
export function nearestTransient(
  times: readonly number[],
  at: number,
  radiusSec: number
): number | null {
  if (times.length === 0) return null;

  let low = 0;
  let high = times.length - 1;

  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < at) low = middle + 1;
    else high = middle;
  }

  // `low` is the first time at or after `at`. Its neighbour before is the only
  // other candidate.
  let best: number | null = null;
  let bestDistance = Infinity;

  for (const index of [low - 1, low]) {
    if (index < 0 || index >= times.length) continue;

    const distance = Math.abs(times[index] - at);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = times[index];
    }
  }

  return bestDistance <= radiusSec ? best : null;
}
