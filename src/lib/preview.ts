/**
 * The preview path — the same operations, over wavesurfer's own `<audio>`.
 *
 * There is no second implementation of the chain here. `linkStack` is the same
 * function the export path calls, given the same stack and the same measured
 * gains. That is
 * [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md): the operations are
 * the same nodes with the same settings, so **what you hear and what you export
 * cannot disagree**.
 *
 * ```
 *   export:  AudioBufferSourceNode ──▶ region envelope ──▶ linkStack ──▶ render
 *  preview:  MediaElementAudioSource ─▶ region envelope ──▶ linkStack ──▶ speakers
 *                                       └──────── shared ─────────┘
 * ```
 *
 * ## Why the media element and not a decoded buffer
 *
 * Ticket 019 weighed both. An `AudioBufferSourceNode` would make preview and
 * export share the samples as well as the operations — and it would cost a
 * decoded buffer for as long as the track is on screen. That is 115.2 MB for
 * five minutes at 48 kHz and **1.04 GB for forty-five**, against a 1 GB ceiling
 * that already counts every loaded file.
 *
 * The media element streams. Nothing is held, the ceiling never bites, and
 * wavesurfer keeps the playhead, the click-to-seek, the scroll and the
 * region-out handling it already had. Only the samples' route changes.
 *
 * ## The one-way door
 *
 * `createMediaElementSource` **permanently** re-routes an element into the
 * graph. It cannot be undone, and calling it twice on one element throws. So:
 *
 * - it is called once per card, and the node is kept for that card's life;
 * - **"Preview effects: off" is a chain with no operations, not a bypass.** An
 *   element that has been routed can never play on its own again, so there is
 *   nothing to bypass to.
 */

import { EditStack, Region, needsMeasurement } from "./edit-stack";
import { linkStack, scheduleRegionEnvelope } from "./graph";
import { sharedAudioContext } from "./audio-context";

/**
 * The longest track preview will measure by itself, in seconds.
 *
 * Loudness and peak normalization cannot know their gain until something has
 * heard the whole region, and hearing it means decoding it. That costs a wait
 * before the first sound, and the wait tracks length:
 *
 * | Track | Wait | Decoded, 44.1 kHz stereo |
 * |---|---|---|
 * | 30 seconds | ~0.15 s | 10.6 MB |
 * | 5 minutes | ~2.3 s | 105.8 MB |
 * | 10 minutes | ~5 s | 211.7 MB |
 * | 45 minutes | ~23 s | 952.6 MB |
 *
 * Ten minutes is where five seconds stops being a pause and starts being a
 * freeze. Above it, preview says the level is not normalized and offers to
 * measure anyway — it never decides quietly, which is how the memory ceiling
 * already behaves.
 */
export const PREVIEW_MEASURE_LIMIT_SEC = 600;

/** True when this region is short enough for preview to measure unasked. */
export function measuresUnasked(region: Region): boolean {
  return region.end - region.start <= PREVIEW_MEASURE_LIMIT_SEC;
}

export type PreviewPlan = {
  region: Region;
  stack: EditStack;

  /**
   * Gains already measured for this stack, keyed by operation index.
   *
   * Empty means nothing has measured yet. A measuring operation with no gain is
   * **left out of the chain**, rather than guessed at — see `usableStack`.
   */
  measured: ReadonlyMap<number, number>;

  /**
   * The **Preview effects** switch.
   *
   * Off means you hear the cut with the region's own gain and fades, and the
   * track's whole stack left out. This is the only sanctioned way for preview to
   * differ from export, and the user asks for it explicitly.
   */
  effects: boolean;
};

export type PreviewGraph = {
  /**
   * Rebuilds the chain for a new plan. Safe to call while playing.
   *
   * Called whenever the stack, the measurement or the effects switch changes, so
   * a slider moved during playback is heard at once.
   */
  update: (plan: PreviewPlan) => void;

  /**
   * Writes the region envelope for playback resuming at `positionSec`.
   *
   * Called on play and on every seek. wavesurfer owns the transport, so this is
   * how the envelope stays in step with a clock this module does not drive.
   */
  schedule: (region: Region, positionSec: number) => void;

  /** Silences the chain. The source node stays — see "the one-way door". */
  dispose: () => void;
};

/**
 * Where an element's graph is remembered: **on the element itself**.
 *
 * `createMediaElementSource` throws `InvalidStateError` on a second call for one
 * element, and there is no way to ask an element whether it has been routed. So
 * the answer has to be written down somewhere that lives exactly as long as the
 * element does.
 *
 * A module-level `WeakMap` was tried first and is not good enough. Anything that
 * makes a second instance of this module gets a second, empty map — and the hot
 * reload during ticket 019's own testing did exactly that, threw, and **blanked
 * the card**. A property on the element survives it, and is collected with the
 * element just as a `WeakMap` entry would be.
 */
const ATTACHED = "__soundslicePreviewGraph";

type Routed = HTMLMediaElement & { [ATTACHED]?: PreviewGraph };

/**
 * Routes a media element through the edit stack.
 *
 * Safe to call more than once for one element — the second call returns the
 * graph the first made, which is what makes React StrictMode's double mount
 * harmless. The returned handle is how the card changes what is heard
 * afterwards.
 */
export function attachPreview(element: HTMLMediaElement): PreviewGraph {
  const existing = (element as Routed)[ATTACHED];
  if (existing) return existing;

  const context = sharedAudioContext();
  const source = context.createMediaElementSource(element);

  // The region's gain and fades. One node for the life of the card, because
  // rebuilding it would drop the envelope mid-fade.
  const envelope = context.createGain();
  source.connect(envelope);

  let tail: AudioNode | null = null;

  const update = (plan: PreviewPlan) => {
    // Disconnect the envelope's outputs only. Everything downstream is
    // unreachable after that and the collector takes it.
    envelope.disconnect();
    tail?.disconnect();

    tail = linkStack(
      context,
      envelope,
      plan.effects ? usablePlan(plan.stack, plan.measured) : EMPTY_PLAN
    );

    tail.connect(context.destination);
  };

  const schedule = (region: Region, positionSec: number) => {
    scheduleRegionEnvelope(
      envelope.gain,
      region,
      region.end - region.start,
      positionSec,
      context.currentTime
    );
  };

  const dispose = () => {
    envelope.disconnect();
    tail?.disconnect();
    tail = null;
  };

  const graph = { update, schedule, dispose };
  (element as Routed)[ATTACHED] = graph;

  // Development builds only — `import.meta.env.DEV` is a compile-time constant,
  // so this block is removed from the production bundle rather than skipped.
  //
  // wavesurfer keeps its `<audio>` element out of the DOM, so a test cannot find
  // it any other way, and driving playback through the card's button is not
  // reliable: `isPlaying` is a ref that desyncs whenever a region ends on its
  // own. Every preview measurement in tickets 019 and 020 needs this.
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const registry = ((window as unknown as Record<string, unknown>)
      .__previewElements ??= []) as HTMLMediaElement[];

    registry.push(element);
    // Bounded, so a long development session with many remounts does not hold
    // every element it ever made. The live ones are always at the end.
    if (registry.length > 16) registry.splice(0, registry.length - 16);
  }

  return graph;
}

/**
 * Resumes the shared context, which starts suspended until a user gesture.
 *
 * Pressing play **is** that gesture, so in practice this resolves at once.
 */
export async function resumePreview(): Promise<void> {
  const context = sharedAudioContext();
  if (context.state === "suspended") await context.resume();
}

const EMPTY_PLAN = { stack: [] as EditStack, measured: new Map<number, number>() };

/**
 * The stack with every unmeasured operation dropped, **and its gains renumbered
 * to match**.
 *
 * `buildGraph` throws when a measuring operation has no gain, and it is right
 * to: an export that silently skipped normalization would be wrong and nobody
 * would know. Preview is the opposite case. It is allowed to play before a
 * measurement exists, and the card says so on screen, so dropping the operation
 * is the honest thing rather than an error the user cannot act on.
 *
 * The renumbering is the part that is easy to get wrong. `measured` is keyed by
 * position in the **original** stack, so dropping operation 0 would make every
 * later gain address the wrong operation — a limiter set to a loudness gain, and
 * no error anywhere.
 */
function usablePlan(
  stack: EditStack,
  measured: ReadonlyMap<number, number>
): { stack: EditStack; measured: Map<number, number> } {
  const kept: EditStack = [];
  const gains = new Map<number, number>();

  stack.forEach((operation, index) => {
    const gain = measured.get(index);

    if (needsMeasurement(operation)) {
      if (gain === undefined) return;
      gains.set(kept.length, gain);
    }

    kept.push(operation);
  });

  return { stack: kept, measured: gains };
}
