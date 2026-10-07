/**
 * **Split at transients** — one region per attack. Ticket 032.
 *
 * The other half of what transient detection was built for. The magnet uses the
 * onsets to land an edge; this uses them to cut a drum loop, a phrase of
 * plucked notes, or a take full of claps into one region per hit.
 *
 * ## The shape of each region
 *
 * - **It starts a little before its attack.** `leadInMs`, 10 ms by default.
 *   Onset detection lands on the sample where the level jumps, and the first
 *   few milliseconds of a real attack rise from below that. A region that
 *   started exactly on the onset would clip the front off every hit.
 * - **Its fade-in is shorter than its lead-in.** A 20 ms fade — the default for
 *   every other region — would soften the very transient the tool cut at. Half
 *   the lead-in, at most 5 ms, removes the click and keeps the attack.
 * - **It ends where the next begins.** The regions tile the file from the first
 *   attack to the end, so a join of them plays the original back. The tail
 *   keeps a short fade-out, so a region exported alone does not click.
 * - **Attacks closer than `minRegionMs` make one region.** A flam is one hit.
 *
 * What comes before the first attack is not a region. It is the silence or
 * noise before anything was played, which is what the user is cutting away.
 *
 * Plain maths, no Web Audio — Vitest reads it under Node. Advanced view only, so
 * only the region toolbar imports it. Standing rule 6.
 */

import { Region, defaultRegion } from "./edit-stack";
import type { TransientSplitSettings } from "./region-tool-prefs";

export type { TransientSplitSettings };

export const TRANSIENT_SPLIT_DEFAULTS: TransientSplitSettings = {
  minRegionMs: 100,
  leadInMs: 10,
};

export const TRANSIENT_SPLIT_RANGES = {
  minRegionMs: { min: 20, max: 2000, step: 10 },
  leadInMs: { min: 0, max: 50, step: 1 },
} as const;

/** The longest fade-in a region cut at an attack gets, in milliseconds. */
export const ATTACK_FADE_IN_MS = 5;

/** The fade-out at the tail of each region, in milliseconds. */
export const TAIL_FADE_OUT_MS = 10;

/** Clamps every number into its range. A stored value may be out of date. */
export function clampSplitSettings(
  settings: TransientSplitSettings
): TransientSplitSettings {
  const clamp = (value: number, range: { min: number; max: number }) =>
    Math.min(range.max, Math.max(range.min, value));

  return {
    minRegionMs: clamp(settings.minRegionMs, TRANSIENT_SPLIT_RANGES.minRegionMs),
    leadInMs: clamp(settings.leadInMs, TRANSIENT_SPLIT_RANGES.leadInMs),
  };
}

/**
 * One region per attack, from a list of onsets in seconds.
 *
 * Zero onsets gives zero regions — a file with no attack in it has nothing to
 * cut at, and that is legal. The caller says so rather than inventing one.
 */
export function regionsFromOnsets(
  onsets: readonly number[],
  durationSec: number,
  raw: TransientSplitSettings = TRANSIENT_SPLIT_DEFAULTS
): Region[] {
  const settings = clampSplitSettings(raw);
  const leadIn = settings.leadInMs / 1000;
  const minLength = settings.minRegionMs / 1000;

  // Sorted, inside the file, and thinned so no two are closer than allowed.
  const starts: number[] = [];
  for (const onset of [...onsets].sort((a, b) => a - b)) {
    if (!(onset >= 0 && onset < durationSec)) continue;

    const start = Math.max(0, onset - leadIn);
    const previous = starts[starts.length - 1];
    if (previous !== undefined && start - previous < minLength) continue;

    starts.push(start);
  }

  // The last region must be long enough to hold its fades. A hit in the final
  // few milliseconds of the file joins the region before it.
  while (
    starts.length > 1 &&
    durationSec - starts[starts.length - 1] < minLength
  ) {
    starts.pop();
  }

  const fadeInMs = Math.min(ATTACK_FADE_IN_MS, settings.leadInMs / 2);

  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : durationSec;
    const region = defaultRegion(start, end);

    return {
      ...region,
      fade: { inMs: fadeInMs, outMs: TAIL_FADE_OUT_MS },
    };
  });
}
