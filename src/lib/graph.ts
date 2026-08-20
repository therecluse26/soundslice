/**
 * `buildGraph` — one function, one implementation.
 *
 * ```
 * buildGraph(context, plan)
 *         │
 *         ├──▶ new AudioContext(…)          → what you hear
 *         └──▶ new OfflineAudioContext(…)   → what you export
 * ```
 *
 * Both contexts run the same nodes with the same settings at the same
 * 128-sample block size, so preview and export **cannot** disagree. That is the
 * whole point of [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md), and
 * it is the reason there is no second audio code path anywhere in this app.
 *
 * The region is cut by `AudioBufferSourceNode.start(0, offset, duration)`. No
 * sample loop survives. `AudioTrimmer.trimAudio` froze the page for 454 ms
 * doing this by hand, and drew zero frames while it did.
 */

import { EditStack, Operation, Region } from "./edit-stack";
import { dbToGain, fadeTimes } from "./dsp";
import { CompressorSettings, makeupGain } from "./compressor-calibration";

/**
 * Every set of compressor settings a stack will build, so a caller can
 * calibrate them all before building the graph.
 *
 * The limiter is a compressor too — a high ratio and a fast attack — so it is
 * in this list and it is the one that matters most.
 */
export function compressorSettingsIn(stack: EditStack): CompressorSettings[] {
  const settings: CompressorSettings[] = [];

  for (const operation of stack) {
    if (operation.op === "compressor") {
      settings.push({
        thresholdDb: operation.thresholdDb,
        ratio: operation.ratio,
        kneeDb: operation.kneeDb,
        attackMs: operation.attackMs,
        releaseMs: operation.releaseMs,
      });
    }
    if (operation.op === "limiter") {
      settings.push({
        thresholdDb: operation.ceilingDb,
        ratio: 20,
        kneeDb: 0,
        attackMs: 3,
        releaseMs: 50,
      });
    }
  }

  return settings;
}

export type GraphPlan = {
  /** The decoded source file. The region indexes into this. */
  source: AudioBuffer;
  region: Region;
  stack: EditStack;

  /**
   * The gain a measuring operation resolved to, keyed by its index in `stack`.
   *
   * `render.ts` fills this in with one extra pass per measuring operation. An
   * operation that needs a measurement and does not have one is a bug in the
   * caller, and `buildGraph` throws rather than rendering the wrong audio.
   */
  measured?: ReadonlyMap<number, number>;

  /**
   * Build only `stack[0 .. upTo)`. Used by a measuring pass, which has to hear
   * the audio arriving at an operation, not leaving it.
   */
  upTo?: number;

  /**
   * Context time the region starts at. Zero for an offline render; the live
   * context's `currentTime` plus a little for preview.
   */
  startTime?: number;
};

export type BuiltGraph = {
  /** Not started. The caller calls `start`, because preview and export differ. */
  source: AudioBufferSourceNode;
  /** The last node in the chain. The caller connects it. */
  tail: AudioNode;
  /** Region length in seconds, after clamping to the end of the file. */
  durationSec: number;
};

/**
 * One operation's nodes, as one thing the chain can connect through.
 *
 * Most operations are a single node, so `input` and `output` are the same
 * object. An EQ is a chain of `BiquadFilterNode`s and has two different ends.
 */
type Segment = { input: AudioNode; output: AudioNode };

/**
 * Builds the region cut, the region's own properties, then the track's stack.
 *
 * Order is fixed and it is not the canonical order's business:
 *
 * ```
 *   region:  cut → gain and fade
 *    track:  the stack, exactly as given
 * ```
 *
 * The region is cut first because the region says *what audio* and the stack
 * says *how it sounds*. The stack's own order is the caller's to decide —
 * Simple view uses `simpleStack`, Advanced view lets the user drag.
 */
export function buildGraph(
  context: BaseAudioContext,
  plan: GraphPlan
): BuiltGraph {
  const { source: buffer, region, stack } = plan;
  const startTime = plan.startTime ?? 0;
  const upTo = plan.upTo ?? stack.length;

  const start = Math.max(0, Math.min(region.start, buffer.duration));
  const end = Math.max(start, Math.min(region.end, buffer.duration));
  const durationSec = end - start;

  const source = context.createBufferSource();
  source.buffer = buffer;

  let tail: AudioNode = source;

  // The region's own gain and its fade edges, in one node. Two gain nodes in
  // series would be identical and cost a node; one envelope carries both.
  tail = link(tail, one(regionGainNode(context, region, durationSec, startTime)));

  for (let index = 0; index < upTo; index++) {
    tail = link(tail, operationSegment(context, stack[index], index, plan));
  }

  return { source, tail, durationSec };
}

function one(node: AudioNode): Segment {
  return { input: node, output: node };
}

function link(from: AudioNode, segment: Segment): AudioNode {
  from.connect(segment.input);
  return segment.output;
}

/**
 * The region's gain, with its fade edges written as automation on the same
 * `AudioParam`.
 *
 * Region gain **stacks** with the track's gain, it does not replace it. That is
 * not a rule this function enforces — it is what two `GainNode`s in series
 * already do, and it is clip gain in every DAW.
 */
function regionGainNode(
  context: BaseAudioContext,
  region: Region,
  durationSec: number,
  startTime: number
): GainNode {
  const node = context.createGain();
  const level = dbToGain(region.gainDb);
  const { fadeInEnd, fadeOutStart } = fadeTimes(
    durationSec,
    region.fade.inMs,
    region.fade.outMs
  );

  const gain = node.gain;

  if (fadeInEnd > 0) {
    gain.setValueAtTime(0, startTime);
    gain.linearRampToValueAtTime(level, startTime + fadeInEnd);
  } else {
    gain.setValueAtTime(level, startTime);
  }

  if (fadeOutStart < durationSec) {
    gain.setValueAtTime(level, startTime + fadeOutStart);
    gain.linearRampToValueAtTime(0, startTime + durationSec);
  }

  return node;
}

function operationSegment(
  context: BaseAudioContext,
  operation: Operation,
  index: number,
  plan: GraphPlan
): Segment {
  switch (operation.op) {
    case "eq":
      return eqSegment(context, operation.bands);

    case "compressor":
      return compressorSegment(context, {
        thresholdDb: operation.thresholdDb,
        ratio: operation.ratio,
        kneeDb: operation.kneeDb,
        attackMs: operation.attackMs,
        releaseMs: operation.releaseMs,
      });

    case "limiter":
      // A limiter is a compressor with a high ratio and a fast attack. These
      // five numbers are `audio-processors.ts`'s `limit()`, unchanged.
      return compressorSegment(context, {
        thresholdDb: operation.ceilingDb,
        ratio: 20,
        kneeDb: 0,
        attackMs: 3,
        releaseMs: 50,
      });

    case "gain": {
      const node = context.createGain();
      node.gain.value = dbToGain(operation.db);
      return one(node);
    }

    case "peakNormalization":
    case "loudness": {
      const node = context.createGain();
      node.gain.value = measuredGain(operation, index, plan);
      return one(node);
    }

    case "noiseReduction":
      throw new Error(
        "Noise reduction has no graph yet. It needs an AudioWorklet and a " +
          "noise profile, and neither exists. See the map's feature tickets."
      );

    default: {
      // Every name in the union is handled above. This catches a name added to
      // `Operation` and not to this switch, which would otherwise be dropped
      // silently and change the audio.
      const unreachable: never = operation;
      throw new Error(`Unknown operation: ${JSON.stringify(unreachable)}`);
    }
  }
}

function measuredGain(
  operation: Operation,
  index: number,
  plan: GraphPlan
): number {
  const gain = plan.measured?.get(index);

  if (gain === undefined) {
    throw new Error(
      `Operation ${index} (${operation.op}) needs a measurement and has none. ` +
        "renderRegion fills these in; a caller building a graph by hand must too."
    );
  }

  return gain;
}

/** One `BiquadFilterNode` per band, in the order the user set them. */
function eqSegment(
  context: BaseAudioContext,
  bands: { type: BiquadFilterType; hz: number; db: number; q: number }[]
): Segment {
  if (bands.length === 0) return one(context.createGain());

  let head: BiquadFilterNode | null = null;
  let tail: BiquadFilterNode | null = null;

  for (const band of bands) {
    const filter = context.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.hz;
    filter.gain.value = band.db;
    filter.Q.value = band.q;

    if (tail) tail.connect(filter);
    if (!head) head = filter;
    tail = filter;
  }

  return { input: head as BiquadFilterNode, output: tail as BiquadFilterNode };
}

/**
 * A `DynamicsCompressorNode`, with the makeup gain it applies on its own taken
 * back off.
 *
 * Chromium's implementation adds a **constant +0.541 dB** for the limiter's
 * settings, at every level below the threshold. Nothing asked for it, the Web
 * Audio specification does not mention it, and another browser may use a
 * different figure — so leaving it in would make the same settings sound
 * different on different browsers.
 *
 * `makeupGain` is measured once per set of settings and cached. It reads 1 for
 * settings nobody has calibrated, which is the old behaviour, so a caller that
 * forgets to call `calibrateAll` gets an unchanged export rather than a broken
 * one. `render.ts` and `preview.ts` both call it.
 *
 * See [`compressor-calibration.ts`](./compressor-calibration.ts).
 */
function compressorSegment(
  context: BaseAudioContext,
  settings: CompressorSettings
): Segment {
  const node = context.createDynamicsCompressor();
  node.threshold.value = settings.thresholdDb;
  node.ratio.value = settings.ratio;
  node.knee.value = settings.kneeDb;
  node.attack.value = settings.attackMs / 1000;
  node.release.value = settings.releaseMs / 1000;

  const makeup = makeupGain(settings);
  if (makeup === 1) return one(node);

  const correction = context.createGain();
  correction.gain.value = 1 / makeup;
  node.connect(correction);

  return { input: node, output: correction };
}
