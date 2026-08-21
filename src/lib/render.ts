/**
 * The render path — replaying an edit stack into audio.
 *
 * One `OfflineAudioContext`, **created at the source file's own sample rate**.
 * That is [the edit stack design](../../.wayfinder/designs/edit-stack.md)
 * section 10, and it fixes a standing rule 1 break: baselines finding 3 measured
 * all six test files at 44.1 kHz on disk decoding to 48 kHz, because
 * `decodeAudioData` follows the audio hardware. The same file on two machines
 * produced different bytes. It does not any more.
 *
 * ## Passes
 *
 * Most stacks render once. An operation that cannot know its own gain until
 * something has heard the whole region costs one extra pass:
 *
 * 1. Render the graph **truncated before** that operation. Measure its output.
 * 2. Put the resulting gain in place.
 *
 * Two such operations cost two extra passes, because the second one's input
 * depends on the first one's gain. Simple view's "Normalize Levels? Yes" with
 * "Apply Post Processing? Yes" is exactly that case: three passes, against the
 * four full renders plus a 430 ms per-sample trim loop it replaces.
 */

import { EditStack, Operation, Region, needsMeasurement } from "./edit-stack";
import { buildGraph, compressorSettingsIn } from "./graph";
import { calibrateAll } from "./compressor-calibration";
import { joinedTimeline, peakNormalizationGain } from "./dsp";
import { loudnessGain } from "./loudness";
import { analyse } from "./encoder";
import type { Analysis } from "./encode-protocol";

/** Thrown when the caller abandoned this render between passes. */
export class RenderCancelled extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "RenderCancelled";
  }
}

export type RenderOptions = {
  /**
   * Called with 0 to 1 across every pass.
   *
   * Costs nineteen suspend and resume round trips per pass. See
   * `scheduleProgress` for why it is not a worklet.
   */
  onProgress?: (fraction: number) => void;

  /**
   * Checked between passes.
   *
   * An `OfflineAudioContext` has no stop, so a pass always runs to completion.
   * Cancel abandons the result; it does not stop the work. The CPU is wasted and
   * the screen is always right — the trade the design accepts.
   */
  isCancelled?: () => boolean;

  /**
   * Called with the gains this render measured, before the final pass.
   *
   * Preview needs the same numbers export used, or the two disagree about level.
   * An export is the most expensive way to learn them and it happens anyway, so
   * the caller hands them to `preview-measurements.ts` and the next press of
   * play is instant.
   */
  onMeasured?: (measured: ReadonlyMap<number, number>) => void;
};

/**
 * How many times a render reports progress.
 *
 * Twenty is a bar that moves in 5% steps. More costs more suspend and resume
 * round trips through the audio thread for no visible gain.
 */
const PROGRESS_POINTS = 20;

/**
 * The shortest gap between two progress points, in frames.
 *
 * A suspend time is quantized to the nearest 128-sample render quantum, and two
 * points that quantize to the same frame are an error. 1024 frames is eight
 * quanta, which no rounding can close.
 */
const MIN_PROGRESS_GAP_FRAMES = 1024;

/**
 * Renders a track's regions through its stack, into one buffer.
 *
 * **One region is the ordinary export.** Several are laid end to end — a
 * **join** — and the stack runs once over the whole thing, so a compressor
 * keeps its envelope across the seams and a loudness operation resolves to one
 * gain for the file rather than a different one per region.
 *
 * The order is the caller's. This does not sort.
 *
 * The returned buffer is fresh and nothing else holds it, so the caller may
 * transfer it to the encode worker. That is the one safe case for transferring,
 * and the reason nothing here caches a decoded buffer.
 */
export async function renderRegions(
  source: AudioBuffer,
  regions: readonly Region[],
  stack: EditStack,
  options: RenderOptions = {}
): Promise<AudioBuffer> {
  // A track with no regions exports nothing, and `planSlices` skips it. Reaching
  // here would build a one-frame context and write a file of silence, which is
  // the shape of the defect ticket 016 fixed — an empty export reporting itself
  // complete.
  if (regions.length === 0) {
    throw new Error(
      "renderRegions was given no regions. A track with none exports nothing; " +
        "planSlices skips it rather than writing a one-frame file."
    );
  }

  const totalPasses = measuringIndicesOf(stack).length + 1;

  const passProgress = (pass: number) =>
    options.onProgress
      ? (fraction: number) =>
          options.onProgress!((pass + fraction) / totalPasses)
      : undefined;

  const measured = await measureStack(source, regions, stack, {
    ...options,
    onPassProgress: passProgress,
  });

  options.onMeasured?.(measured);

  return renderPass(
    source,
    regions,
    stack,
    measured,
    undefined,
    passProgress(totalPasses - 1)
  );
}

/**
 * The gain every measuring operation in this stack resolves to, keyed by its
 * index.
 *
 * Preview needs these as much as export does, and it must get the same numbers
 * or the two disagree. Returning them lets preview reuse a measurement it
 * already paid for, which is what the design means by "loudness is briefly
 * stale after an edit".
 *
 * A stack with no measuring operation returns an empty map and costs nothing.
 */
export async function measureStack(
  source: AudioBuffer,
  regions: readonly Region[],
  stack: EditStack,
  options: RenderOptions & {
    onPassProgress?: (pass: number) => ((fraction: number) => void) | undefined;
  } = {}
): Promise<Map<number, number>> {
  // Before any graph is built. `buildGraph` is synchronous and reads the
  // calibration cache; nothing measured means no correction, which is the old
  // behaviour rather than a failure.
  await calibrateAll(compressorSettingsIn(stack));

  const measuringIndices = measuringIndicesOf(stack);
  const measured = new Map<number, number>();

  for (let pass = 0; pass < measuringIndices.length; pass++) {
    const index = measuringIndices[pass];

    // The truncated pass hears the **whole** joined timeline up to this
    // operation, so `analyse` measures the file that will actually be written
    // and `gainFor` returns one gain for all of it. Joining needed nothing here.
    const heard = await renderPass(
      source,
      regions,
      stack,
      measured,
      index,
      options.onPassProgress?.(pass)
    );

    const operation = stack[index];

    // Ask for the cheap answer unless the expensive one is needed. A peak is
    // one scan; ITU-R BS.1770 is two biquads and a 4× oversampling filter over
    // the whole region.
    const analysis = await analyse(
      heard,
      operation.op === "loudness" ? "loudness" : "peak"
    ).done;
    if (analysis === null) throw new RenderCancelled();

    measured.set(index, gainFor(operation, analysis));

    if (options.isCancelled?.()) throw new RenderCancelled();
  }

  return measured;
}

function measuringIndicesOf(stack: EditStack): number[] {
  const indices: number[] = [];
  stack.forEach((operation, index) => {
    if (needsMeasurement(operation)) indices.push(index);
  });
  return indices;
}

/** The gain an operation resolves to, once something has measured its input. */
function gainFor(operation: Operation, analysis: Analysis): number {
  if (operation.op === "peakNormalization") {
    return peakNormalizationGain(analysis.peak, operation.targetDbfs);
  }

  if (operation.op === "loudness") {
    return loudnessGain(
      analysis.lufs ?? -Infinity,
      operation.targetLufs,
      analysis.truePeakDb ?? -Infinity,
      operation.ceilingDbTp
    );
  }

  throw new Error(
    `Cannot resolve a gain for ${operation.op}. Only peak normalization and ` +
      "loudness are measured operations."
  );
}

/**
 * One pass.
 *
 * **The rate is always the source buffer's own, and there is no way to override
 * it.** A caller that wants another rate decodes at that rate —
 * `AudioLoader.loadAudioFile` takes a `chooseRate` for exactly this. Resampling
 * here instead would go through an `AudioBufferSourceNode`, which Chrome and
 * Safari resample by linear interpolation, and that aliases on the way down.
 * Ticket 011 removed the option rather than leave a foot-gun in the signature.
 */
async function renderPass(
  source: AudioBuffer,
  regions: readonly Region[],
  stack: EditStack,
  measured: ReadonlyMap<number, number>,
  upTo: number | undefined,
  onProgress: ((fraction: number) => void) | undefined
): Promise<AudioBuffer> {
  const sampleRate = source.sampleRate;

  // The clamp and the frame count live in one place now. They used to exist
  // here and again in `buildGraph`, which is two chances to disagree about what
  // a region past the end of the file means.
  const frames = joinedTimeline(regions, source.duration, sampleRate).frameCount;

  const context = new OfflineAudioContext(
    source.numberOfChannels,
    frames,
    sampleRate
  );

  const graph = buildGraph(context, { source, regions, stack, measured, upTo });
  graph.tail.connect(context.destination);

  if (onProgress) scheduleProgress(context, frames, sampleRate, onProgress);

  // The cut. One call per region, no sample loop. `AudioTrimmer.trimAudio` did
  // this by hand and froze the page for 454 ms drawing zero frames.
  graph.start();

  return context.startRendering();
}

/**
 * Reports progress by suspending the render at intervals and resuming it.
 *
 * ## Why this is not an `AudioWorklet`
 *
 * Ticket 002 measured a worklet counting blocks at the tail of the graph and
 * settled on it. It was built, it worked, and it **leaked the whole render**.
 *
 * Thirty identical renders of `clip-30s.wav`, 303 MB of output, RSS read from
 * `/proc` and garbage collected through CDP before each reading:
 *
 * | | RSS growth |
 * |---|---|
 * | no progress | **+10.3 MB** |
 * | worklet | **+322.8 MB** |
 * | worklet, port closed and node disconnected | **+316.4 MB** |
 *
 * Closing the port did not help, so the `MessagePort` was not the root.
 * Calling `audioWorklet.addModule` on an `OfflineAudioContext` keeps that
 * context alive, and the context holds the buffer it rendered. **There is no
 * way to release it: `OfflineAudioContext` has no `close()`, and its state is
 * already `"closed"` the moment rendering finishes.**
 *
 * `suspend(time)` needs no module and leaves nothing behind. The edit stack
 * design called it "awkward" — it was weighing it for cancellation, where it
 * genuinely is. For progress it is nineteen promises and a `resume()`.
 */
function scheduleProgress(
  context: OfflineAudioContext,
  frames: number,
  sampleRate: number,
  onProgress: (fraction: number) => void
): void {
  // Round the step up to a whole number of render quanta, so every suspend
  // time lands exactly on a boundary and no two can collide.
  const step =
    Math.ceil(Math.max(frames / PROGRESS_POINTS, MIN_PROGRESS_GAP_FRAMES) / 128) *
    128;

  for (let frame = step; frame < frames; frame += step) {
    const fraction = frame / frames;

    context
      .suspend(frame / sampleRate)
      .then(() => {
        onProgress(fraction);
        // Not awaited. Rendering is stopped until this call lands, so any wait
        // here is dead time, and a failure to resume would hang the export.
        void context.resume();
      })
      .catch(() => {
        // The point was refused, so the render was never suspended there and
        // needs no resume. One missing step on a progress bar is not an error.
      });
  }
}
