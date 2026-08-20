/**
 * Turning a region's numbers into places on screen, and back.
 *
 * The maths behind the inline controls a user drags on the waveform: the gain
 * line's height, and where a fade handle sits. Plain numbers in, plain numbers
 * out, no DOM — so Vitest reads it under Node. That is `dsp.ts`'s rule, and it
 * is what keeps [`region-overlay.ts`](./region-overlay.ts) a thin shell of
 * `style.top = …` around something that can be tested.
 *
 * ## Why the controls are on the region and not under it
 *
 * They were under it, as a list of rows with sliders. Every DAW puts them on the
 * clip, because that is where you are looking while you cut. A row of sliders
 * below asks the user to look away from the thing they are editing, and then to
 * work out which row goes with which region.
 */

/**
 * What a region's own gain may be set to, in dB.
 *
 * −24 dB is far enough down to bury a region under another take. +12 dB is as
 * far up as clip gain goes anywhere, and the limiter still catches what it
 * pushes past full scale.
 */
export const REGION_GAIN_RANGE = { min: -24, max: 12 } as const;

/**
 * How close to 0 dB the gain line snaps to exactly 0.
 *
 * A detent at unity. Every DAW has one, because "back to where it was" is the
 * most common thing to ask of a clip gain line, and hitting 0.0 by hand on a
 * 100-pixel-tall region is not possible.
 */
export const GAIN_DETENT_DB = 0.25;

/**
 * Where the gain line sits, as a fraction from the **top** of the region.
 *
 * Top is the loudest, bottom the quietest, which is the way round every DAW
 * draws it and the way round a drag upward means louder.
 */
export function gainLineFraction(gainDb: number): number {
  const { min, max } = REGION_GAIN_RANGE;
  const clamped = Math.min(max, Math.max(min, gainDb));

  return (max - clamped) / (max - min);
}

/** The gain a line at this fraction from the top means, snapped and clamped. */
export function gainAtFraction(fraction: number): number {
  const { min, max } = REGION_GAIN_RANGE;
  const held = Math.min(1, Math.max(0, fraction));

  return snapGain(max - held * (max - min));
}

/**
 * The gain a drag of `dy` pixels lands on, from where the drag started.
 *
 * Down is quieter, so the sign is inverted. Measured from the start of the
 * gesture rather than from the last frame, so a slow drag and a fast one over
 * the same distance end in the same place.
 */
export function gainAfterDrag(
  startGainDb: number,
  dy: number,
  regionHeightPx: number
): number {
  if (!(regionHeightPx > 0)) return snapGain(startGainDb);

  const { min, max } = REGION_GAIN_RANGE;
  const moved = (dy / regionHeightPx) * (max - min);

  return snapGain(Math.min(max, Math.max(min, startGainDb - moved)));
}

/** Rounded to a tenth of a decibel, and snapped to 0 near unity. */
export function snapGain(db: number): number {
  const rounded = Math.round(db * 10) / 10;
  return Math.abs(rounded) <= GAIN_DETENT_DB ? 0 : rounded;
}

/**
 * A fade, clamped to what this region can hold.
 *
 * A fade may be as long as the whole region. Two fades that together overrun it
 * are **not** an error here: `fadeTimes` shortens both to fit, which is the rule
 * it has held since ticket 008 and the reason a 30 ms region with 20 ms fades
 * does not dip in the middle.
 */
export function clampFadeMs(fadeMs: number, durationSec: number): number {
  const longest = Math.max(0, durationSec * 1000);
  return Math.round(Math.min(longest, Math.max(0, fadeMs)));
}

/** How wide a fade is on screen, in pixels. */
export function fadeWidthPx(
  fadeMs: number,
  regionWidthPx: number,
  durationSec: number
): number {
  if (!(durationSec > 0) || !(regionWidthPx > 0)) return 0;

  const width = (fadeMs / 1000 / durationSec) * regionWidthPx;
  return Math.min(regionWidthPx, Math.max(0, width));
}

/**
 * The fade a handle dragged `dx` pixels lands on.
 *
 * `direction` is 1 for the fade in, whose handle moves right to lengthen it, and
 * −1 for the fade out, whose handle moves left.
 */
export function fadeAfterDrag(
  startFadeMs: number,
  dx: number,
  regionWidthPx: number,
  durationSec: number,
  direction: 1 | -1
): number {
  if (!(regionWidthPx > 0)) return clampFadeMs(startFadeMs, durationSec);

  const moved = (dx / regionWidthPx) * durationSec * 1000 * direction;
  return clampFadeMs(startFadeMs + moved, durationSec);
}

/** `+3.0 dB`, `0.0 dB`, `−6.5 dB`. What the gain line's readout says. */
export function formatGain(gainDb: number): string {
  const sign = gainDb > 0 ? "+" : gainDb < 0 ? "−" : "";
  return `${sign}${Math.abs(gainDb).toFixed(1)} dB`;
}

/** `205 ms`, or `1.20 s` once it is long enough for seconds to read better. */
export function formatFade(fadeMs: number): string {
  return fadeMs >= 1000
    ? `${(fadeMs / 1000).toFixed(2)} s`
    : `${Math.round(fadeMs)} ms`;
}
