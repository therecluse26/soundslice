/**
 * The edit stack — the ordered list of operations held against a track.
 *
 * This is the shape settled by
 * [the edit stack design](../../.wayfinder/designs/edit-stack.md), section 2. It
 * is types and plain functions only: no Web Audio, no DOM, so Vitest reads it
 * under Node. The graph that turns these into sound is `graph.ts`.
 *
 * `BiquadFilterType` is a type-only reference to `lib.dom`. TypeScript erases
 * it, so nothing DOM-shaped survives into the module a Node test imports.
 */

/** One band of the EQ operation. The Web Audio names, unchanged. */
export type EqBand = {
  type: BiquadFilterType;
  hz: number;
  db: number;
  q: number;
};

/** A frequency measurement taken once, from a region the user marks as silent. */
export type NoiseProfile = {
  id: string;
  magnitudes: Float32Array;
  fftSize: number;
};

/**
 * One reversible change on a track's stack. Order is its position in the array.
 *
 * All seven names are typed here, including the two `graph.ts` cannot build yet.
 * A stack is serialised by name, so a name that exists in the union and not in
 * the builder is a loud failure at export time. A name missing from the union
 * would be a silent one.
 */
export type Operation =
  | { op: "noiseReduction"; amount: number; profile: NoiseProfile }
  | { op: "eq"; bands: EqBand[] }
  | {
      op: "compressor";
      thresholdDb: number;
      ratio: number;
      kneeDb: number;
      attackMs: number;
      releaseMs: number;
    }
  | { op: "gain"; db: number }
  /**
   * `ceilingDbTp` is not in the design's version of this union. It belongs to
   * the operation, not beside it: lifting a quiet track to a loudness target can
   * push its peaks past full scale, and the cap that stops it decides the gain.
   * A stack that serialised the target and not the ceiling would reload as
   * different audio.
   */
  | { op: "loudness"; targetLufs: number; ceilingDbTp: number }
  | { op: "peakNormalization"; targetDbfs: number }
  | { op: "limiter"; ceilingDb: number };

export type OperationName = Operation["op"];

/** The ordered list of operations held against a track. */
export type EditStack = Operation[];

/**
 * What a region owns. Times are in the *source file's* seconds, always.
 *
 * Time and pitch (`stretch`) is typed and not built. It needs an `AudioWorklet`
 * and it has no control, so nothing creates one. `graph.ts` throws rather than
 * ignoring it.
 */
export type Region = {
  start: number;
  end: number;
  gainDb: number;
  fade: { inMs: number; outMs: number };
  stretch?: { rate: number; semitones: number };
};

/**
 * The fade every slice has had since before this map existed.
 *
 * `audio-trimmer.ts:28` hard-coded 20 ms in and out and offered no switch. It is
 * now a region property with the same default, so no existing user's output
 * changes because of this field alone.
 */
export const DEFAULT_FADE_MS = 20;

/** The region a track gets when it has none of its own. */
export function defaultRegion(start: number, end: number): Region {
  return {
    start,
    end,
    gainDb: 0,
    fade: { inMs: DEFAULT_FADE_MS, outMs: DEFAULT_FADE_MS },
  };
}

/**
 * Today's compressor, to the number.
 *
 * `audio-processors.ts:54` used threshold −8 dB, ratio 4, knee 0, attack 8 ms,
 * release 50 ms. Keeping these exact means "Apply Post Processing? Yes" sounds
 * the same after the rewrite as before it.
 */
export const COMPRESSOR_DEFAULTS = {
  op: "compressor",
  thresholdDb: -8,
  ratio: 4,
  kneeDb: 0,
  attackMs: 8,
  releaseMs: 50,
} as const;

/** Today's limiter, to the number. `audio-processors.ts:97`. */
export const LIMITER_DEFAULTS = {
  op: "limiter",
  ceilingDb: -0.95,
} as const;

/**
 * Today's normalize, to the number.
 *
 * `audio-processors.ts:137` set the gain to `1 / peak`, which is a target of
 * 0 dBFS. Nothing else is expressible in the old code, so 0 is the default.
 */
export const PEAK_NORMALIZATION_DEFAULTS = {
  op: "peakNormalization",
  targetDbfs: 0,
} as const;

/**
 * The loudness target, and the true-peak ceiling that caps it.
 *
 * **−14 LUFS** because that is what the "Normalize Levels?" switch is for: a set
 * of tracks that sound equally loud beside each other. Of the music platforms
 * only Spotify publishes a number, and it is −14. Do not label this as anyone
 * else's official target — the research is explicit about that.
 *
 * **−1 dBTP** is the standard ceiling. A true peak is not a sample peak: a
 * signal whose every sample sits below full scale can still reconstruct above it
 * between them, which is what a converter and a lossy encoder both do. One
 * decibel of headroom is what EBU R128 and every streaming platform ask for.
 */
export const LOUDNESS_DEFAULTS = {
  op: "loudness",
  targetLufs: -14,
  ceilingDbTp: -1,
} as const;

/** What Advanced view may set the loudness target to. Broadcast to streaming. */
export const LOUDNESS_TARGET_RANGE = { min: -30, max: -8 } as const;

/**
 * The canonical order, top to bottom. Design section 5.
 *
 * Simple view does not use this to sort — see `simpleStack`, which is an
 * explicit stack. Advanced view reorders freely, and this is what "Reset order"
 * puts it back to.
 */
export const CANONICAL_ORDER: OperationName[] = [
  "noiseReduction",
  "eq",
  "compressor",
  "gain",
  "loudness",
  "peakNormalization",
  "limiter",
];

/**
 * Sorts a stack into the canonical order, keeping the relative order of
 * operations that share a name.
 *
 * `Array.prototype.sort` is stable in every engine this app supports, so two
 * `peakNormalization` entries keep the order the user put them in.
 */
export function sortToCanonical(stack: EditStack): EditStack {
  return [...stack].sort(
    (a, b) => CANONICAL_ORDER.indexOf(a.op) - CANONICAL_ORDER.indexOf(b.op)
  );
}

/**
 * True when this operation cannot know its own gain until something has heard
 * the whole region.
 *
 * Each one costs the render path one extra pass. See `render.ts`.
 */
export function needsMeasurement(operation: Operation): boolean {
  return operation.op === "peakNormalization" || operation.op === "loudness";
}

/** The two switches Simple view shows, plus the target Advanced view may set. */
export type SimpleSwitches = {
  normalizeAudio: boolean;
  applyPostProcessing: boolean;
  /** Defaults to −14 LUFS. Simple view never sets it. */
  loudnessTargetLufs?: number;
};

/**
 * Simple view's two switches, as a stack.
 *
 * This reproduces `applyProcessingPipeline` exactly, which is ticket 008's
 * fifth requirement: the same settings must give the same output as before.
 *
 * | Normalize | Post-processing | Stack |
 * |---|---|---|
 * | No | No | limiter |
 * | No | Yes | compressor, limiter |
 * | Yes | No | **loudness**, limiter |
 * | Yes | Yes | peak normalization, compressor, **loudness**, limiter |
 *
 * ## The two normalizations do two different jobs
 *
 * The old pipeline ran normalize, compress, normalize, limit, and both
 * normalizations were peak. Ticket 010 replaced only the **last** one.
 *
 * - **The first is gain staging.** It lifts a quiet recording up to the
 *   compressor's −8 dB threshold so the compressor engages at all. Peak
 *   normalization is the right tool for that, and keeping it means the
 *   compressor hears exactly what it heard before, so "Apply Post Processing?
 *   Yes" sounds the same as it always did.
 * - **The last one sets the level you hear.** That is loudness, not peak. Two
 *   tracks can share a peak and sound nothing alike, and "this will make the
 *   levels more consistent" is what the switch's own tooltip promises.
 *
 * **This changes exported bytes for existing users**, and it is the change the
 * switch was always supposed to make.
 *
 * The canonical order has no level-setting slot before the compressor, so it
 * cannot express this. That is a hole in the design, recorded in ticket 008.
 *
 * The limiter is unconditional. Design section 5 settled that: on by default,
 * last, and Simple view never turns it off. It is a sample-peak limiter, so it
 * does not catch inter-sample peaks — the loudness operation's own true-peak
 * ceiling does that, before the limiter ever sees the signal.
 */
export function simpleStack({
  normalizeAudio,
  applyPostProcessing,
  loudnessTargetLufs,
}: SimpleSwitches): EditStack {
  const stack: EditStack = [];

  if (normalizeAudio && applyPostProcessing) {
    stack.push({ ...PEAK_NORMALIZATION_DEFAULTS });
  }
  if (applyPostProcessing) stack.push({ ...COMPRESSOR_DEFAULTS });
  if (normalizeAudio) {
    stack.push({
      ...LOUDNESS_DEFAULTS,
      targetLufs: loudnessTargetLufs ?? LOUDNESS_DEFAULTS.targetLufs,
    });
  }
  stack.push({ ...LIMITER_DEFAULTS });

  return stack;
}
