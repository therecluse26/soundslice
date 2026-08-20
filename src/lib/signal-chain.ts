/**
 * The signal chain — the edit stack as something you can look at.
 *
 * The stack was already an ordered list of operations. This file gives that
 * list a picture: one **block** per operation, drawn left to right in the order
 * the audio passes through them, with an input meter before the first and an
 * output meter after the last.
 *
 * Nothing here touches Web Audio or the DOM. It is the block model, the two
 * response curves, and the maths that turns a pointer position into a number —
 * so Vitest reads all of it under Node. `graph.ts` remains the one place that
 * builds nodes, and it is unchanged by this file existing.
 *
 * ## The curves are drawn from the same numbers the nodes are built from
 *
 * `eqResponseDb` reproduces `BiquadFilterNode`'s own response, and
 * `compressorOutputDb` reproduces `DynamicsCompressorNode`'s own transfer
 * function. Both are the formulas the Web Audio specification gives, not an
 * approximation that looks about right. That is
 * [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md)'s spirit applied to
 * a drawing: a curve that disagreed with the sound would be worse than no
 * curve, because the user would trust it.
 */

import {
  COMPRESSOR_DEFAULTS,
  EqBand,
  EditStack,
  LIMITER_DEFAULTS,
  LOUDNESS_DEFAULTS,
  Operation,
  OperationName,
  PEAK_NORMALIZATION_DEFAULTS,
  sortToCanonical,
} from "./edit-stack";

/** One block of the chain, as the panel needs to know it. */
export type BlockInfo = {
  op: OperationName;
  /** What the block is called on the tile. Short enough to fit. */
  short: string;
  /** What the block is called when there is room. */
  label: string;
  /** One line saying what it does to the audio. */
  what: string;
  /**
   * False when `graph.ts` cannot build this operation yet.
   *
   * An unbuilt block is drawn and cannot be switched on. Hiding it would be
   * dishonest in the other direction — the operation is named in the `Operation`
   * union, it is part of the design, and the panel says so plainly.
   */
  built: boolean;
};

/**
 * Every block, in the order the audio passes through them.
 *
 * This is `CANONICAL_ORDER` and it is checked against it by a test. Two lists
 * that had to agree and did not would put the picture out of step with the
 * sound, which is the one thing this panel must never do.
 */
export const BLOCKS: BlockInfo[] = [
  {
    op: "noiseReduction",
    short: "Noise",
    label: "Noise reduction",
    what: "Subtracts a measured noise profile from the whole track.",
    built: false,
  },
  {
    op: "eq",
    short: "EQ",
    label: "Equalizer",
    what: "Lifts or cuts chosen frequencies.",
    built: true,
  },
  {
    op: "compressor",
    short: "Comp",
    label: "Compressor",
    what: "Evens out the loud and quiet parts.",
    built: true,
  },
  {
    op: "gain",
    short: "Gain",
    label: "Gain",
    what: "One fixed change in level, up or down.",
    built: true,
  },
  {
    op: "loudness",
    short: "Loud",
    label: "Loudness",
    what: "Brings the track to a loudness target in LUFS.",
    built: true,
  },
  {
    op: "peakNormalization",
    short: "Peak",
    label: "Peak normalization",
    what: "Scales the track so its loudest sample reaches a target.",
    built: true,
  },
  {
    op: "limiter",
    short: "Limit",
    label: "Limiter",
    what: "Holds the peaks below a ceiling.",
    built: true,
  },
];

/** The block by name. Every name in `OperationName` has one. */
export function blockInfo(op: OperationName): BlockInfo {
  const found = BLOCKS.find((block) => block.op === op);
  if (!found) throw new Error(`No block for operation: ${op}`);
  return found;
}

/* ------------------------------------------------------------------ ranges */

/**
 * What a control may be set to.
 *
 * The compressor's four are the Web Audio node's own limits, not a taste
 * judgement. `DynamicsCompressorNode` clamps outside them without complaining,
 * so a slider that went further would move and change nothing.
 */
export const COMPRESSOR_RANGES = {
  thresholdDb: { min: -60, max: 0, step: 0.5 },
  ratio: { min: 1, max: 20, step: 0.1 },
  kneeDb: { min: 0, max: 40, step: 0.5 },
  attackMs: { min: 0, max: 1000, step: 1 },
  releaseMs: { min: 0, max: 1000, step: 1 },
} as const;

export const GAIN_RANGE = { min: -24, max: 24, step: 0.1 } as const;
export const LIMITER_CEILING_RANGE = { min: -12, max: 0, step: 0.05 } as const;
export const PEAK_TARGET_RANGE = { min: -12, max: 0, step: 0.1 } as const;

export const EQ_GAIN_RANGE = { min: -18, max: 18 } as const;
export const EQ_HZ_RANGE = { min: 20, max: 20000 } as const;
export const EQ_Q_RANGE = { min: 0.1, max: 18 } as const;

/**
 * The three bands an EQ starts with, **all at 0 dB**.
 *
 * Switching a block on must not change the sound. A user turns EQ on to reach
 * for a control, not to hear something happen, and an EQ that arrived with a
 * curve already in it would make the block's own switch an edit.
 *
 * A shelf at each end and a bell in the middle is the smallest set that can do
 * useful work: cut rumble, lift presence, tame hiss.
 */
export const DEFAULT_EQ_BANDS: EqBand[] = [
  { type: "lowshelf", hz: 120, db: 0, q: 0.7 },
  { type: "peaking", hz: 1000, db: 0, q: 1 },
  { type: "highshelf", hz: 6000, db: 0, q: 0.7 },
];

/** The rate the drawn EQ curve assumes when nobody names one. */
export const CURVE_SAMPLE_RATE = 48000;

/* -------------------------------------------------------------- the stack */

/** This operation, if the stack holds one. The first, if it holds several. */
export function operationIn<N extends OperationName>(
  stack: EditStack,
  op: N
): Extract<Operation, { op: N }> | undefined {
  return stack.find((one) => one.op === op) as
    | Extract<Operation, { op: N }>
    | undefined;
}

/** The operation a block is switched on with. Every one is already named. */
export function defaultOperation(op: OperationName): Operation {
  switch (op) {
    case "eq":
      return { op: "eq", bands: DEFAULT_EQ_BANDS.map((band) => ({ ...band })) };
    case "compressor":
      return { ...COMPRESSOR_DEFAULTS };
    case "gain":
      return { op: "gain", db: 0 };
    case "loudness":
      return { ...LOUDNESS_DEFAULTS };
    case "peakNormalization":
      return { ...PEAK_NORMALIZATION_DEFAULTS };
    case "limiter":
      return { ...LIMITER_DEFAULTS };
    case "noiseReduction":
      throw new Error(
        "Noise reduction has no default: it needs a measured noise profile, " +
          "and there is nothing to measure one from yet."
      );
  }
}

/**
 * The stack with this operation switched on, in canonical order.
 *
 * A stack that already holds it is returned unchanged, so switching a block on
 * twice cannot make two of it.
 */
export function withOperation(stack: EditStack, op: OperationName): EditStack {
  if (operationIn(stack, op)) return stack;
  return sortToCanonical([...stack, defaultOperation(op)]);
}

/** The stack with every operation of this name taken out. */
export function withoutOperation(stack: EditStack, op: OperationName): EditStack {
  return stack.filter((one) => one.op !== op);
}

/**
 * The stack with this operation's settings replaced.
 *
 * Position is kept, so changing a threshold cannot reorder the chain. An
 * operation that is not in the stack is added in canonical order, which is what
 * a control that was dragged before its block was switched on should do.
 */
export function replaceOperation(stack: EditStack, next: Operation): EditStack {
  const index = stack.findIndex((one) => one.op === next.op);
  if (index === -1) return sortToCanonical([...stack, next]);

  const copy = [...stack];
  copy[index] = next;
  return copy;
}

/** The one line under a block's name on its tile. */
export function blockSummary(operation: Operation): string {
  switch (operation.op) {
    case "eq": {
      const moved = operation.bands.filter((band) => band.db !== 0).length;
      return moved === 0 ? "flat" : `${moved} of ${operation.bands.length} moved`;
    }
    case "compressor":
      // No decimal place on the threshold. Two numbers have to fit one tile,
      // and a threshold is chosen in whole decibels far more often than a
      // ceiling is — the control below the chain carries the exact value.
      return `${formatDb(operation.thresholdDb, 0)} · ${formatRatio(operation.ratio)}`;
    case "gain":
      return formatDb(operation.db);
    case "loudness":
      return `${signed(operation.targetLufs, 0)} LUFS`;
    case "peakNormalization":
      return `${formatDb(operation.targetDbfs)}FS`;
    case "limiter":
      // Two places, matching the limiter's own control. A ceiling lives in
      // hundredths — the default is −0.95 dB — and one place would round it to
      // −0.9 on the tile and −0.95 in the control, for the same number.
      return formatDb(operation.ceilingDb, 2);
    case "noiseReduction":
      return `${Math.round(operation.amount * 100)}%`;
  }
}

/** A signed decibel value, with a real minus sign. `+3.0 dB`, `−0.95 dB`. */
export function formatDb(db: number, places = 1): string {
  return `${signed(db, places)} dB`;
}

/**
 * A signed number with a **real** minus sign, U+2212.
 *
 * `toFixed` writes a hyphen-minus, which is narrower than a plus and makes a
 * column of readouts jitter as the value crosses zero. The region readout
 * already uses U+2212; every number in this panel matches it.
 */
function signed(value: number, places: number): string {
  const rounded = Math.abs(value) < 0.5 * 10 ** -places ? 0 : value;
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(places)}`;
}

/** A compressor ratio. `4:1`, `2.5:1`, `∞:1` at the node's own maximum. */
export function formatRatio(ratio: number): string {
  if (ratio >= COMPRESSOR_RANGES.ratio.max) return "∞:1";
  const places = Number.isInteger(ratio) ? 0 : 1;
  return `${ratio.toFixed(places)}:1`;
}

/* ------------------------------------------------------------- the EQ curve */

/**
 * Where a frequency sits across the EQ, from 0 at 20 Hz to 1 at 20 kHz.
 *
 * Logarithmic, because hearing is. On a linear axis everything below 2 kHz —
 * which is most of what anyone equalises — would live in the leftmost tenth of
 * the picture.
 */
export function hzFraction(hz: number): number {
  const { min, max } = EQ_HZ_RANGE;
  const clamped = Math.min(max, Math.max(min, hz));
  return Math.log(clamped / min) / Math.log(max / min);
}

/** The inverse: the frequency at a fraction across the EQ. */
export function fractionHz(fraction: number): number {
  const { min, max } = EQ_HZ_RANGE;
  const clamped = Math.min(1, Math.max(0, fraction));
  return min * (max / min) ** clamped;
}

/** Where a gain sits down the EQ, from 0 at the top to 1 at the bottom. */
export function eqGainFraction(db: number): number {
  const { min, max } = EQ_GAIN_RANGE;
  const clamped = Math.min(max, Math.max(min, db));
  return (max - clamped) / (max - min);
}

/** The inverse: the gain at a fraction down the EQ. */
export function fractionEqGain(fraction: number): number {
  const { min, max } = EQ_GAIN_RANGE;
  const clamped = Math.min(1, Math.max(0, fraction));
  return max - clamped * (max - min);
}

/** A band's own contribution at one frequency, in decibels. */
export function bandResponseDb(
  band: EqBand,
  hz: number,
  sampleRate = CURVE_SAMPLE_RATE
): number {
  const { b0, b1, b2, a0, a1, a2 } = biquadCoefficients(band, sampleRate);
  const w = (2 * Math.PI * hz) / sampleRate;

  // H(e^{-jw}) with z^-1 = cos(w) − j·sin(w), so the imaginary parts are
  // negative. Getting that sign wrong leaves the magnitude right for a
  // symmetric filter and wrong for every shelf.
  const cos1 = Math.cos(w);
  const cos2 = Math.cos(2 * w);
  const sin1 = Math.sin(w);
  const sin2 = Math.sin(2 * w);

  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = a0 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);

  const den = Math.hypot(denRe, denIm);
  if (den === 0) return 0;

  return 20 * Math.log10(Math.hypot(numRe, numIm) / den);
}

/** Every band together, at one frequency. Filters in series add in decibels. */
export function eqResponseDb(
  bands: readonly EqBand[],
  hz: number,
  sampleRate = CURVE_SAMPLE_RATE
): number {
  let db = 0;
  for (const band of bands) db += bandResponseDb(band, hz, sampleRate);
  return db;
}

/**
 * The whole curve, one value per pixel column.
 *
 * Returned as a `Float32Array` because the caller draws it and never reads one
 * value out of it. `points` is the width of the canvas in device pixels, so the
 * curve is computed at the resolution it is drawn at and no finer.
 */
export function eqCurve(
  bands: readonly EqBand[],
  points: number,
  sampleRate = CURVE_SAMPLE_RATE
): Float32Array {
  const curve = new Float32Array(Math.max(0, points));

  for (let index = 0; index < curve.length; index++) {
    const fraction = curve.length === 1 ? 0 : index / (curve.length - 1);
    curve[index] = eqResponseDb(bands, fractionHz(fraction), sampleRate);
  }

  return curve;
}

type Coefficients = {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
};

/**
 * The RBJ cookbook coefficients, with Web Audio's own reading of `Q`.
 *
 * **`Q` does not mean one thing across the types**, and this is the trap:
 *
 * | Type | What Web Audio does with `Q` |
 * |---|---|
 * | `lowpass`, `highpass` | reads it **in decibels** |
 * | `bandpass`, `notch`, `allpass`, `peaking` | reads it as a plain number |
 * | `lowshelf`, `highshelf` | **ignores it** — slope is fixed at S = 1 |
 *
 * A curve drawn with the plain number for a `lowpass` shows a resonant peak
 * that nobody would hear. The specification is explicit about all three cases.
 */
function biquadCoefficients(band: EqBand, sampleRate: number): Coefficients {
  const w0 = (2 * Math.PI * Math.min(band.hz, sampleRate / 2)) / sampleRate;
  const cos0 = Math.cos(w0);
  const sin0 = Math.sin(w0);

  const A = 10 ** (band.db / 40);
  const plainQ = Math.max(1e-6, band.q);
  const alphaQ = sin0 / (2 * plainQ);
  // Q in decibels, for the two filters that read it that way.
  const alphaDb = sin0 / (2 * 10 ** (band.q / 20));
  // S = 1, which reduces the cookbook's shelf alpha to this.
  const alphaShelf = (sin0 / 2) * Math.SQRT2;

  switch (band.type) {
    case "lowpass":
      return {
        b0: (1 - cos0) / 2,
        b1: 1 - cos0,
        b2: (1 - cos0) / 2,
        a0: 1 + alphaDb,
        a1: -2 * cos0,
        a2: 1 - alphaDb,
      };

    case "highpass":
      return {
        b0: (1 + cos0) / 2,
        b1: -(1 + cos0),
        b2: (1 + cos0) / 2,
        a0: 1 + alphaDb,
        a1: -2 * cos0,
        a2: 1 - alphaDb,
      };

    case "bandpass":
      return {
        b0: alphaQ,
        b1: 0,
        b2: -alphaQ,
        a0: 1 + alphaQ,
        a1: -2 * cos0,
        a2: 1 - alphaQ,
      };

    case "notch":
      return {
        b0: 1,
        b1: -2 * cos0,
        b2: 1,
        a0: 1 + alphaQ,
        a1: -2 * cos0,
        a2: 1 - alphaQ,
      };

    case "allpass":
      return {
        b0: 1 - alphaQ,
        b1: -2 * cos0,
        b2: 1 + alphaQ,
        a0: 1 + alphaQ,
        a1: -2 * cos0,
        a2: 1 - alphaQ,
      };

    case "peaking":
      return {
        b0: 1 + alphaQ * A,
        b1: -2 * cos0,
        b2: 1 - alphaQ * A,
        a0: 1 + alphaQ / A,
        a1: -2 * cos0,
        a2: 1 - alphaQ / A,
      };

    case "lowshelf": {
      const root = 2 * Math.sqrt(A) * alphaShelf;
      return {
        b0: A * (A + 1 - (A - 1) * cos0 + root),
        b1: 2 * A * (A - 1 - (A + 1) * cos0),
        b2: A * (A + 1 - (A - 1) * cos0 - root),
        a0: A + 1 + (A - 1) * cos0 + root,
        a1: -2 * (A - 1 + (A + 1) * cos0),
        a2: A + 1 + (A - 1) * cos0 - root,
      };
    }

    case "highshelf": {
      const root = 2 * Math.sqrt(A) * alphaShelf;
      return {
        b0: A * (A + 1 + (A - 1) * cos0 + root),
        b1: -2 * A * (A - 1 + (A + 1) * cos0),
        b2: A * (A + 1 + (A - 1) * cos0 - root),
        a0: A + 1 - (A - 1) * cos0 + root,
        a1: 2 * (A - 1 - (A + 1) * cos0),
        a2: A + 1 - (A - 1) * cos0 - root,
      };
    }
  }
}

/* ----------------------------------------------------- the compressor curve */

/** The five numbers a compressor curve is drawn from. */
export type CompressorCurveSettings = {
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
};

/** The quietest input the compressor curve is drawn from, in dBFS. */
export const COMPRESSOR_FLOOR_DB = -60;

/**
 * What comes out, for what goes in. Both in dBFS.
 *
 * This is `DynamicsCompressorNode`'s own transfer function, in three parts:
 *
 * ```
 *   below the knee   →  unchanged
 *   inside the knee  →  a quadratic, so the corner is round and not a kink
 *   above the knee   →  threshold + (input − threshold) / ratio
 * ```
 *
 * A knee of 0 has no middle part, and the division that would compute it is
 * skipped rather than producing infinity.
 */
export function compressorOutputDb(
  inputDb: number,
  settings: CompressorCurveSettings
): number {
  const { thresholdDb, ratio, kneeDb } = settings;
  const half = kneeDb / 2;

  if (inputDb <= thresholdDb - half) return inputDb;
  if (kneeDb > 0 && inputDb < thresholdDb + half) {
    const over = inputDb - (thresholdDb - half);
    return inputDb + ((1 / ratio - 1) * over * over) / (2 * kneeDb);
  }

  return thresholdDb + (inputDb - thresholdDb) / ratio;
}

/**
 * How much the compressor is pulling down, at one input level, in decibels.
 *
 * Never negative: a compressor below its threshold reduces nothing. This is the
 * number the gain-reduction bar shows.
 */
export function gainReductionDb(
  inputDb: number,
  settings: CompressorCurveSettings
): number {
  return Math.max(0, inputDb - compressorOutputDb(inputDb, settings));
}

/**
 * Where a decibel value sits on the compressor curve, from 0 at the floor to 1
 * at full scale.
 *
 * The same mapping on both axes, so the untouched part of the curve is a true
 * 45-degree line and a user can see at a glance where compression starts.
 */
export function compressorFraction(db: number): number {
  const clamped = Math.min(0, Math.max(COMPRESSOR_FLOOR_DB, db));
  return (clamped - COMPRESSOR_FLOOR_DB) / -COMPRESSOR_FLOOR_DB;
}

/** The inverse: the level at a fraction along a compressor axis. */
export function fractionCompressorDb(fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return COMPRESSOR_FLOOR_DB + clamped * -COMPRESSOR_FLOOR_DB;
}

/* ---------------------------------------------------------- pointer to value */

/**
 * How close a pointer has to be to a band's dot to grab it, in CSS pixels.
 *
 * Larger than the dot is drawn. A 6-pixel dot needs a target you can hit
 * without aiming, and the alternative — missing and starting a new drag — moves
 * the wrong band.
 */
export const EQ_POINT_RADIUS_PX = 16;

/** Where a band's dot sits across the EQ, in pixels. */
export function eqPointX(hz: number, width: number): number {
  return hzFraction(hz) * width;
}

/** Where a band's dot sits down the EQ, in pixels. */
export function eqPointY(db: number, height: number): number {
  return eqGainFraction(db) * height;
}

/** The frequency and gain a point in the picture stands for. */
export function eqValuesAtPoint(
  x: number,
  y: number,
  width: number,
  height: number
): { hz: number; db: number } {
  return {
    hz: fractionHz(width === 0 ? 0 : x / width),
    db: fractionEqGain(height === 0 ? 0 : y / height),
  };
}

/**
 * Which band's dot a point grabs, or −1 for none.
 *
 * The **nearest** one inside the radius, not the first. Two bands dragged on
 * top of each other would otherwise always hand back the lower-numbered one,
 * and the other would be unreachable for the rest of the session.
 */
export function eqBandAtPoint(
  bands: readonly EqBand[],
  x: number,
  y: number,
  width: number,
  height: number,
  radius = EQ_POINT_RADIUS_PX
): number {
  let best = -1;
  let bestDistance = radius;

  bands.forEach((band, index) => {
    const distance = Math.hypot(
      x - eqPointX(band.hz, width),
      y - eqPointY(band.db, height)
    );

    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });

  return best;
}

/**
 * The ratio that puts the curve at `outputDb` when full scale goes in.
 *
 * The inverse of the transfer function's upper segment, so the ratio handle can
 * live on the curve at 0 dBFS and be dragged straight up and down. A handle at
 * the top of the curve is where the compression is largest and easiest to see.
 *
 * Clamped both ways: dragging it to the 45-degree line is 1:1, and dragging it
 * flat onto the threshold is the node's own maximum rather than infinity.
 */
export function ratioForOutputAtFullScale(
  thresholdDb: number,
  outputDb: number
): number {
  const over = outputDb - thresholdDb;
  if (over <= 0) return COMPRESSOR_RANGES.ratio.max;

  return clampTo(-thresholdDb / over, COMPRESSOR_RANGES.ratio);
}

/** Clamps one control to what its node will actually accept. */
export function clampTo(
  value: number,
  range: { min: number; max: number }
): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** Keeps every compressor setting inside the node's own limits. */
export function clampCompressor(
  operation: Extract<Operation, { op: "compressor" }>
): Extract<Operation, { op: "compressor" }> {
  return {
    op: "compressor",
    thresholdDb: clampTo(operation.thresholdDb, COMPRESSOR_RANGES.thresholdDb),
    ratio: clampTo(operation.ratio, COMPRESSOR_RANGES.ratio),
    kneeDb: clampTo(operation.kneeDb, COMPRESSOR_RANGES.kneeDb),
    attackMs: clampTo(operation.attackMs, COMPRESSOR_RANGES.attackMs),
    releaseMs: clampTo(operation.releaseMs, COMPRESSOR_RANGES.releaseMs),
  };
}

/** Keeps one EQ band inside the ranges its controls offer. */
export function clampBand(band: EqBand): EqBand {
  return {
    type: band.type,
    hz: clampTo(band.hz, EQ_HZ_RANGE),
    db: clampTo(band.db, EQ_GAIN_RANGE),
    q: clampTo(band.q, EQ_Q_RANGE),
  };
}

