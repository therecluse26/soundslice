/**
 * Drawing a meter. Plain canvas, no React, no store.
 *
 * This runs sixty times a second while a track plays, so it does the least work
 * it can: no allocation in the hot path, no layout read it can avoid, and no
 * paint at all when the picture would be identical to the last one.
 *
 * **Nothing here causes a render.** Ticket 020 removed a redraw storm caused by
 * `timeupdate` reaching React. A level that changes sixty times a second is the
 * same problem an order of magnitude worse, so the level never becomes state —
 * it is read on an animation frame and written straight onto a canvas.
 */

import {
  METER_FLOOR_DB,
  MeterState,
  formatMeterDb,
  isClipped,
  meterFraction,
} from "./meter";

/**
 * The three zones of a meter, and where they start.
 *
 * Green, amber, red, from the bottom. It is the convention every meter has used
 * since they had needles, and it is read without a legend:
 *
 * | Zone | Means |
 * |---|---|
 * | green, below −12 dBFS | room to spare |
 * | amber, −12 to −3 dBFS | where a mix should sit |
 * | red, above −3 dBFS | close to the ceiling |
 *
 * These are not the limiter's numbers and they do not change the sound. They
 * are how the bar is coloured, and nothing else reads them.
 */
export const METER_ZONES = {
  amberFromDb: -12,
  redFromDb: -3,
} as const;

export const METER_COLORS = {
  /** tailwind green-500 */
  green: "#22c55e",
  /** tailwind amber-500 */
  amber: "#f59e0b",
  /** tailwind red-500 — the same red the waveform's played part uses */
  red: "#ef4444",
  /** The trough behind the bar. */
  track: "rgba(120, 120, 130, 0.22)",
  /** The held peak line. */
  peak: "rgba(255, 255, 255, 0.85)",
  /** The scale marks on a large meter. */
  tick: "rgba(150, 150, 160, 0.45)",
} as const;

/** Where the scale marks go on a large meter, in dBFS. */
export const METER_TICKS_DB = [0, -6, -12, -24, -36, -48];

export type MeterOrientation = "vertical" | "horizontal";

export type MeterDrawOptions = {
  orientation: MeterOrientation;
  /** Draws the scale marks. Off for the small pair on the transport row. */
  ticks?: boolean;
};

/**
 * What a canvas is currently showing, kept on the canvas itself.
 *
 * So a frame that would paint the same picture paints nothing. At 60 Hz a
 * paused card would otherwise repaint an unchanged empty meter 3600 times a
 * minute. The value is rounded first — a bar cannot move by less than a pixel,
 * so a change smaller than that is not a change.
 */
const DRAWN = "__soundsliceMeterDrawn";

type Painted = HTMLCanvasElement & { [DRAWN]?: string };

/**
 * Draws one meter, and returns true if it actually painted.
 *
 * Sizes the canvas from its own layout every frame rather than on a resize
 * event. It is two property reads, it cannot go stale, and it is the same
 * lesson the region overlay learned: a component that measures once measures at
 * the wrong moment.
 */
export function drawMeter(
  canvas: HTMLCanvasElement,
  state: MeterState,
  nowMs: number,
  options: MeterDrawOptions
): boolean {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));

  const clipped = isClipped(state, nowMs);
  const level = meterFraction(state.db);
  const peak = meterFraction(state.peakDb);

  // Rounded to the pixel the bar would actually reach, so a value that moved by
  // a thousandth of a decibel does not repaint the page.
  const along = options.orientation === "vertical" ? height : width;
  const signature = `${width}x${height}:${Math.round(level * along)}:${Math.round(
    peak * along
  )}:${clipped ? 1 : 0}`;

  if ((canvas as Painted)[DRAWN] === signature) return false;
  (canvas as Painted)[DRAWN] = signature;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = METER_COLORS.track;
  ctx.fillRect(0, 0, width, height);

  if (options.orientation === "vertical") {
    drawVertical(ctx, width, height, level, peak, options.ticks === true);
  } else {
    drawHorizontal(ctx, width, height, level, peak, options.ticks === true);
  }

  if (clipped) {
    // A band across the loud end, drawn over everything. It stays lit after the
    // bar has fallen away, which is the point of it.
    ctx.fillStyle = METER_COLORS.red;
    if (options.orientation === "vertical") ctx.fillRect(0, 0, width, Math.max(2, height * 0.02));
    else ctx.fillRect(width - Math.max(2, width * 0.02), 0, Math.max(2, width * 0.02), height);
  }

  return true;
}

/** The gradient, from the quiet end to the loud end. */
function zoneGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);

  const amber = meterFraction(METER_ZONES.amberFromDb);
  const red = meterFraction(METER_ZONES.redFromDb);

  gradient.addColorStop(0, METER_COLORS.green);
  // Two stops at each boundary, a hair apart, so the zones are three bands and
  // not one long smear. A meter has to be readable at a glance.
  gradient.addColorStop(amber - 0.001, METER_COLORS.green);
  gradient.addColorStop(amber, METER_COLORS.amber);
  gradient.addColorStop(red - 0.001, METER_COLORS.amber);
  gradient.addColorStop(red, METER_COLORS.red);
  gradient.addColorStop(1, METER_COLORS.red);

  return gradient;
}

function drawVertical(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number,
  peak: number,
  ticks: boolean
): void {
  if (ticks) {
    ctx.fillStyle = METER_COLORS.tick;
    for (const db of METER_TICKS_DB) {
      const y = Math.round((1 - meterFraction(db)) * height);
      ctx.fillRect(0, Math.min(height - 1, y), width, 1);
    }
  }

  const barHeight = Math.round(level * height);
  if (barHeight > 0) {
    ctx.fillStyle = zoneGradient(ctx, 0, height, 0, 0);
    ctx.fillRect(0, height - barHeight, width, barHeight);
  }

  if (peak > 0) {
    const y = Math.round((1 - peak) * height);
    ctx.fillStyle = METER_COLORS.peak;
    ctx.fillRect(0, Math.min(height - 2, Math.max(0, y - 1)), width, 2);
  }
}

function drawHorizontal(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number,
  peak: number,
  ticks: boolean
): void {
  if (ticks) {
    ctx.fillStyle = METER_COLORS.tick;
    for (const db of METER_TICKS_DB) {
      const x = Math.round(meterFraction(db) * width);
      ctx.fillRect(Math.min(width - 1, x), 0, 1, height);
    }
  }

  const barWidth = Math.round(level * width);
  if (barWidth > 0) {
    ctx.fillStyle = zoneGradient(ctx, 0, 0, width, 0);
    ctx.fillRect(0, 0, barWidth, height);
  }

  if (peak > 0) {
    const x = Math.round(peak * width);
    ctx.fillStyle = METER_COLORS.peak;
    ctx.fillRect(Math.max(0, Math.min(width - 2, x - 1)), 0, 2, height);
  }
}

/**
 * Writes the number beside a meter, straight into the element.
 *
 * `textContent`, not React state. The same rule the canvas follows, for the
 * same reason: this changes sixty times a second.
 */
export function writeMeterReadout(element: HTMLElement, state: MeterState): void {
  const text = state.db <= METER_FLOOR_DB ? "−∞" : formatMeterDb(state.db);
  if (element.textContent !== text) element.textContent = text;
}
