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
import { dbToGain, fadeTimes, joinedTimeline } from "./dsp";
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
  /** The decoded source file. **Every** region indexes into this one buffer. */
  source: AudioBuffer;

  /**
   * The regions this graph plays, **in output order**.
   *
   * One is the ordinary render. Many are laid end to end — a **join** — each at
   * its own place on the output, each keeping its own gain and fade edges.
   *
   * This module does not sort them and does not know the word "join".
   * `orderedRegions` is the caller's decision, and one day the join strip will
   * override it.
   *
   * `regions.length === 1` is today's graph exactly: one source, one envelope,
   * no extra node. That identity is what lets a join share this code path
   * rather than fork it. Standing rule 1, ADR 0001.
   */
  regions: readonly Region[];

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
  /**
   * Starts every source this graph holds, each at its own place on the output.
   * Call it once, after connecting `tail`.
   *
   * A closure, not an array of source nodes, and the reason is the arguments.
   * A source needs three numbers — when it starts, where it reads from in the
   * file, and how long it plays — and all three have to agree with the frame
   * count the context was built with. Handing the caller an array hands it
   * those three numbers to get right, N times. `render.ts` kept its own copy of
   * the **clamp** alone and that was one number. There is nothing here to get
   * wrong.
   *
   * Calling it twice throws `InvalidStateError` from the first source, which is
   * the same failure a second `start()` has always given.
   */
  start: () => void;

  /** The last node in the chain. The caller connects it. */
  tail: AudioNode;
};

/**
 * One operation's nodes, as one thing the chain can connect through.
 *
 * Most operations are a single node, so `input` and `output` are the same
 * object. An EQ is a chain of `BiquadFilterNode`s and has two different ends.
 */
type Segment = { input: AudioNode; output: AudioNode };

/**
 * Connects the stack after `from`, and returns the new tail.
 *
 * **This is the one implementation of the operations chain, and both paths call
 * it.** Export reaches it through `buildGraph` with an `AudioBufferSourceNode`
 * in front; preview reaches it directly with a `MediaElementAudioSourceNode` in
 * front. What differs between them is where the samples come from. What must
 * never differ is what happens to those samples, and that is this function.
 *
 * That is [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md) held to
 * properly. A second copy of this loop for preview would satisfy the letter of
 * the ADR and break its point.
 */
export function linkStack(
  context: BaseAudioContext,
  from: AudioNode,
  plan: Pick<GraphPlan, "stack" | "measured" | "upTo">
): AudioNode {
  const upTo = plan.upTo ?? plan.stack.length;
  let tail = from;

  for (let index = 0; index < upTo; index++) {
    tail = link(
      tail,
      operationSegment(context, plan.stack[index], index, plan.measured)
    );
  }

  return tail;
}

/**
 * Builds the region cuts, each region's own properties, then the track's stack.
 *
 * Order is fixed and it is not the canonical order's business:
 *
 * ```
 *   regions:  cut → gain and fade, one set per region
 *     track:  the stack, exactly as given, **once** over all of them
 * ```
 *
 * The regions are cut first because a region says *what audio* and the stack
 * says *how it sounds*. The stack's own order is the caller's to decide —
 * Simple view uses `simpleStack`, Advanced view lets the user drag.
 *
 * ## One region, or several
 *
 * ```
 *   one      source ──▶ envelope ──────────────────────▶ linkStack ──▶ tail
 *   joined   source ──▶ envelope_0 ┐
 *            source ──▶ envelope_1 ├──▶ bus ──▶ linkStack ──▶ tail
 *            source ──▶ envelope_k ┘
 * ```
 *
 * **The stack runs once, over the whole thing.** That is the difference between
 * a join and N separate renders, and it is the point of joining: a compressor
 * keeps its envelope across the seams, and a loudness operation resolves to one
 * gain for the whole file instead of a different one per region.
 *
 * **Every source shares the one decoded `AudioBuffer`.** A 45-minute track is
 * 1.04 GB; a join must never hold two of them.
 */
export function buildGraph(
  context: BaseAudioContext,
  plan: GraphPlan
): BuiltGraph {
  const { source: buffer, regions } = plan;
  const startTime = plan.startTime ?? 0;

  const timeline = joinedTimeline(regions, buffer.duration, buffer.sampleRate);

  const heads: AudioNode[] = [];
  const starts: Array<() => void> = [];

  regions.forEach((region, index) => {
    const span = timeline.spans[index];
    const at = startTime + span.atSec;

    const source = context.createBufferSource();
    source.buffer = buffer;

    // The region's own gain and its fade edges, in one node. Two gain nodes in
    // series would be identical and cost a node; one envelope carries both.
    // `regionGainNode` already took an absolute `startTime` — preview needed one
    // to seek into the middle of a fade, and a join needs the same thing.
    const envelope = regionGainNode(context, region, span.durationSec, at);
    source.connect(envelope);

    heads.push(envelope);
    starts.push(() => source.start(at, span.sourceStartSec, span.durationSec));
  });

  // **One region takes no extra node.** A unity `GainNode` is bit-exact either
  // way — `x * 1.0` is `x` in IEEE-754 — so this ternary buys no accuracy. It
  // buys something better: a reviewer asking "did the ordinary export change?"
  // has literally nothing to compare. Same nodes, same count, same arguments.
  const from = heads.length === 1 ? heads[0] : sumInto(context, heads);

  return {
    start: () => starts.forEach((run) => run()),
    tail: linkStack(context, from, plan),
  };
}

/** Where many regions meet, so the chain still has exactly one head. */
function sumInto(context: BaseAudioContext, heads: AudioNode[]): AudioNode {
  const mix = context.createGain();
  for (const head of heads) head.connect(mix);
  return mix;
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
  scheduleRegionEnvelope(node.gain, region, durationSec, 0, startTime);
  return node;
}

/**
 * Writes the region's gain and fade edges onto an `AudioParam`.
 *
 * **Both paths call this, so a fade cannot be one shape on export and another
 * in preview.** Export always calls it with `positionSec` of 0, because a render
 * starts at the region's start and cannot start anywhere else.
 *
 * Preview calls it again on every play and every seek, with the position the
 * user landed on. Seeking into the middle of a fade is a real case — someone
 * clicks near the end of a region to hear how it lands — and the envelope has to
 * pick up where it would already have been, not start over. `envelopeAt` is
 * what makes that exact rather than approximate.
 */
export function scheduleRegionEnvelope(
  gain: AudioParam,
  region: Region,
  durationSec: number,
  /** Seconds into the region that playback is starting from. */
  positionSec: number,
  /** Context time that position is heard at. */
  startTime: number
): void {
  const level = dbToGain(region.gainDb);
  const { fadeInEnd, fadeOutStart } = fadeTimes(
    durationSec,
    region.fade.inMs,
    region.fade.outMs
  );

  const at = Math.max(0, Math.min(positionSec, durationSec));

  gain.cancelScheduledValues(startTime);
  gain.setValueAtTime(
    envelopeAt(at, level, fadeInEnd, fadeOutStart, durationSec),
    startTime
  );

  // Still inside the fade in: ramp to full over what is left of it.
  if (at < fadeInEnd) {
    gain.linearRampToValueAtTime(level, startTime + (fadeInEnd - at));
  }

  if (fadeOutStart < durationSec) {
    // Hold full until the fade out is due, then ramp to silence at the end.
    if (at < fadeOutStart) {
      gain.setValueAtTime(level, startTime + (fadeOutStart - at));
    }
    gain.linearRampToValueAtTime(0, startTime + (durationSec - at));
  }
}

/** The envelope's value at one moment, so a seek can resume from it. */
function envelopeAt(
  at: number,
  level: number,
  fadeInEnd: number,
  fadeOutStart: number,
  durationSec: number
): number {
  if (fadeInEnd > 0 && at < fadeInEnd) return level * (at / fadeInEnd);

  if (fadeOutStart < durationSec && at > fadeOutStart) {
    return level * Math.max(0, (durationSec - at) / (durationSec - fadeOutStart));
  }

  return level;
}

function operationSegment(
  context: BaseAudioContext,
  operation: Operation,
  index: number,
  measured: ReadonlyMap<number, number> | undefined
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
      node.gain.value = measuredGain(operation, index, measured);
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
  measured: ReadonlyMap<number, number> | undefined
): number {
  const gain = measured?.get(index);

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
