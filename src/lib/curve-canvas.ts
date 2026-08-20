/**
 * Drawing the two response curves. Plain canvas, no React, no store.
 *
 * The numbers come from `signal-chain.ts`, which reproduces the Web Audio
 * nodes' own formulas. This file only turns them into pixels, so a curve that
 * looked wrong is a drawing fault and a curve that *is* wrong is a maths fault,
 * and the two can be told apart.
 *
 * Colours are literals for the same reason `waveform-colors.ts` gives: a canvas
 * needs a real colour string and cannot resolve `var(--…)`.
 */

import { EqBand } from "./edit-stack";
import {
  COMPRESSOR_FLOOR_DB,
  CompressorCurveSettings,
  compressorFraction,
  compressorOutputDb,
  eqCurve,
  eqGainFraction,
  eqPointX,
  eqPointY,
  hzFraction,
} from "./signal-chain";

export const CURVE_COLORS = {
  /** The plotted response. tailwind red-500, the app's own accent. */
  curve: "#ef4444",
  /** The area under the response, so the shape reads at a glance. */
  fill: "rgba(239, 68, 68, 0.14)",
  /** The grid. */
  grid: "rgba(140, 140, 155, 0.20)",
  /** The 0 dB line, and the 45-degree line on the compressor. */
  zero: "rgba(150, 150, 165, 0.45)",
  /** A band's dot, and the compressor's handles. */
  point: "#ef4444",
  /** The dot the pointer is on or dragging. */
  pointActive: "#ffffff",
  /** The ring around every dot, so it reads on a light and a dark theme. */
  pointEdge: "rgba(0, 0, 0, 0.35)",
  /** Axis labels. */
  label: "rgba(150, 150, 165, 0.75)",
} as const;

/** Where the EQ draws its vertical grid lines, and which of them get a label. */
export const EQ_GRID_HZ = [
  { hz: 50, label: "" },
  { hz: 100, label: "100" },
  { hz: 500, label: "" },
  { hz: 1000, label: "1k" },
  { hz: 5000, label: "" },
  { hz: 10000, label: "10k" },
];

/** Where the EQ draws its horizontal grid lines, in decibels. */
export const EQ_GRID_DB = [12, 6, 0, -6, -12];

/** The radius a band's dot is drawn at, in CSS pixels. */
export const EQ_POINT_DRAW_PX = 5;

/**
 * Prepares a canvas for drawing and returns its context and CSS size.
 *
 * Sizes from the element's own layout every time, rather than from a resize
 * event. It is two property reads and it cannot go stale — a panel that opens
 * inside an accordion has a width of zero until it does not, and a canvas that
 * measured once would stay one pixel wide forever.
 *
 * `null` when the canvas has no size yet or has no 2D context.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 1 || height < 1) return null;

  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Draw in CSS pixels and let the transform handle the display's density, so
  // every measurement below is the same number the pointer handler works in.
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  return { ctx, width, height };
}

/**
 * Draws the EQ: grid, curve, and one dot per band.
 *
 * `active` is the band under the pointer or being dragged, or −1. It is drawn
 * filled rather than larger, so grabbing a band does not shift the picture.
 */
export function drawEq(
  canvas: HTMLCanvasElement,
  bands: readonly EqBand[],
  active: number,
  sampleRate?: number
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;

  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "top";

  for (const line of EQ_GRID_HZ) {
    const x = Math.round(hzFraction(line.hz) * width) + 0.5;
    ctx.strokeStyle = CURVE_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    if (line.label) {
      ctx.fillStyle = CURVE_COLORS.label;
      ctx.fillText(line.label, x + 3, height - 13);
    }
  }

  for (const db of EQ_GRID_DB) {
    const y = Math.round(eqGainFraction(db) * height) + 0.5;
    ctx.strokeStyle = db === 0 ? CURVE_COLORS.zero : CURVE_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    if (db === EQ_GRID_DB[0] || db === EQ_GRID_DB[EQ_GRID_DB.length - 1]) {
      ctx.fillStyle = CURVE_COLORS.label;
      ctx.fillText(`${db > 0 ? "+" : "−"}${Math.abs(db)}`, 3, y + 2);
    }
  }

  // One value per CSS pixel column. Computing at the drawn resolution and no
  // finer is the whole reason `eqCurve` takes a point count.
  const columns = Math.max(2, Math.round(width));
  const curve = eqCurve(bands, columns, sampleRate);

  ctx.beginPath();
  for (let index = 0; index < columns; index++) {
    const x = (index / (columns - 1)) * width;
    const y = eqGainFraction(curve[index]) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = CURVE_COLORS.curve;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Close the path down to the 0 dB line and fill it, so a cut reads as a dip
  // below the line and a lift as a bulge above it.
  const zeroY = eqGainFraction(0) * height;
  ctx.lineTo(width, zeroY);
  ctx.lineTo(0, zeroY);
  ctx.closePath();
  ctx.fillStyle = CURVE_COLORS.fill;
  ctx.fill();

  bands.forEach((band, index) => {
    const x = eqPointX(band.hz, width);
    const y = eqPointY(band.db, height);

    ctx.beginPath();
    ctx.arc(x, y, EQ_POINT_DRAW_PX, 0, Math.PI * 2);
    ctx.fillStyle = index === active ? CURVE_COLORS.pointActive : CURVE_COLORS.point;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = CURVE_COLORS.pointEdge;
    ctx.stroke();
  });
}

/** Where the compressor's two handles are drawn, in CSS pixels. */
export type CompressorHandles = {
  threshold: { x: number; y: number };
  ratio: { x: number; y: number };
};

/** Where the handles sit for these settings, at this size. */
export function compressorHandles(
  settings: CompressorCurveSettings,
  width: number,
  height: number
): CompressorHandles {
  const thresholdFraction = compressorFraction(settings.thresholdDb);
  const output = compressorOutputDb(0, settings);

  return {
    threshold: {
      x: thresholdFraction * width,
      y: (1 - thresholdFraction) * height,
    },
    ratio: { x: width, y: (1 - compressorFraction(output)) * height },
  };
}

/**
 * Draws the compressor: the 45-degree line, the transfer curve, two handles.
 *
 * There is no moving dot on this curve, and that is deliberate. The signal
 * meters tap the two ends of the whole chain, not the two ends of this one
 * block, so a dot placed from them would be in the wrong place whenever
 * anything sits before the compressor — and a picture that disagrees with the
 * sound is worse than no picture. The honest live numbers are the two chain
 * meters and the difference between them.
 */
export function drawCompressor(
  canvas: HTMLCanvasElement,
  settings: CompressorCurveSettings,
  active: "threshold" | "ratio" | null
): void {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;

  const { ctx, width, height } = prepared;

  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;

  for (const db of [-48, -36, -24, -12]) {
    const fraction = compressorFraction(db);
    ctx.strokeStyle = CURVE_COLORS.grid;

    ctx.beginPath();
    ctx.moveTo(Math.round(fraction * width) + 0.5, 0);
    ctx.lineTo(Math.round(fraction * width) + 0.5, height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, Math.round((1 - fraction) * height) + 0.5);
    ctx.lineTo(width, Math.round((1 - fraction) * height) + 0.5);
    ctx.stroke();
  }

  // Unity: what a compressor that did nothing would draw. The curve leaving it
  // is the whole of what the compressor does.
  ctx.strokeStyle = CURVE_COLORS.zero;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(width, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  const columns = Math.max(2, Math.round(width));
  ctx.beginPath();
  for (let index = 0; index < columns; index++) {
    const fraction = index / (columns - 1);
    const inputDb = COMPRESSOR_FLOOR_DB + fraction * -COMPRESSOR_FLOOR_DB;
    const y = (1 - compressorFraction(compressorOutputDb(inputDb, settings))) * height;

    if (index === 0) ctx.moveTo(fraction * width, y);
    else ctx.lineTo(fraction * width, y);
  }
  ctx.strokeStyle = CURVE_COLORS.curve;
  ctx.lineWidth = 2;
  ctx.stroke();

  const handles = compressorHandles(settings, width, height);

  for (const [name, point] of Object.entries(handles)) {
    ctx.beginPath();
    ctx.arc(
      // The ratio handle sits on the right edge; pull it in so the whole dot is
      // on the canvas and can be grabbed.
      Math.min(width - EQ_POINT_DRAW_PX, Math.max(EQ_POINT_DRAW_PX, point.x)),
      Math.min(height - EQ_POINT_DRAW_PX, Math.max(EQ_POINT_DRAW_PX, point.y)),
      EQ_POINT_DRAW_PX,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = name === active ? CURVE_COLORS.pointActive : CURVE_COLORS.point;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = CURVE_COLORS.pointEdge;
    ctx.stroke();
  }

  ctx.fillStyle = CURVE_COLORS.label;
  ctx.fillText("in", 3, height - 13);
  ctx.fillText("out", 3, 3);
}

