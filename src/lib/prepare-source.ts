/**
 * The work an export does **before** the Web Audio graph: noise reduction
 * (ticket 036) and time and pitch (ticket 037).
 *
 * Neither can be a node in an `OfflineAudioContext`. Both need an
 * `AudioWorklet`, and `addModule` on an offline context leaks the whole context
 * in Chromium — 322 MB over 30 renders. So both run as plain loops in the encode
 * worker, here, and the graph is then built over what they produced.
 *
 * ## The shape of it
 *
 * Each region's stretch of the source — plus a little either side, so the STFT
 * has real audio to warm up on rather than silence — is copied out, sent to the
 * worker, and laid into a new buffer. The regions are moved to where their audio
 * now sits, and the graph is built over the new buffer with the rest of the
 * stack. Every region keeps its id, so crossfades and the join order are
 * untouched.
 *
 * ```
 *   source ─▶ [denoise] ─▶ [stretch] ─▶ new source ─▶ the graph (rest of stack)
 * ```
 *
 * **Noise reduction is always first in the stack.** A profile describes the
 * noise of the raw recording; after an EQ or a gain the noise has a different
 * shape and the profile no longer matches. `withNoiseFirst` holds that, and the
 * chain will not let a block be moved in front of it.
 *
 * **Time and pitch belongs to the region, so it comes before the whole stack
 * too.** A compressor after a stretch hears the stretched audio, which is what
 * a listener hears.
 *
 * Nothing here runs when nothing needs it: a stack with no noise reduction and
 * regions with no stretch go straight to the graph, byte for byte as before.
 */

import { cancel } from "./encoder";
import { denoise, stretch } from "./spectral-jobs";
import { RenderCancelled } from "./render";
import { EditStack, Region, isStretched } from "./edit-stack";

/** Audio kept either side of a region for the STFT to warm up on, in seconds. */
const EDGE_PAD_SEC = 0.1;

export type Prepared = {
  source: AudioBuffer;
  regions: Region[];
  /** The stack the graph should run: the original, minus noise reduction. */
  stack: EditStack;
  /**
   * How many operations were taken off the front of the stack. A measured gain
   * keyed by `stack` index is at `index + indexShift` in the original.
   */
  indexShift: number;
};

export async function prepareSource(
  source: AudioBuffer,
  regions: readonly Region[],
  stack: EditStack,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {}
): Promise<Prepared> {
  const first = stack[0];
  const noise = first?.op === "noiseReduction" ? first : null;
  const rest = noise ? stack.slice(1) : stack;
  const indexShift = noise ? 1 : 0;

  // Noise reduction at 0% is the identity. Dropping it here is what makes a
  // block switched on and left at zero cost nothing.
  const denoising = noise !== null && noise.amount > 0;

  if (!denoising && !regions.some(isStretched)) {
    return { source, regions: [...regions], stack: rest, indexShift };
  }

  const rate = source.sampleRate;
  const segments: Float32Array[][] = [];
  const moved: Region[] = [];
  let atFrame = 0;

  for (let index = 0; index < regions.length; index++) {
    const region = regions[index];
    const report = (fraction: number) =>
      options.onProgress?.((index + fraction) / regions.length);

    const start = Math.max(0, Math.min(region.start, source.duration));
    const end = Math.max(start, Math.min(region.end, source.duration));
    const segStart = Math.max(0, start - EDGE_PAD_SEC);
    const segEnd = Math.min(source.duration, end + EDGE_PAD_SEC);
    const from = Math.round(segStart * rate);
    const to = Math.max(from + 1, Math.round(segEnd * rate));

    let channels: Float32Array[] = Array.from(
      { length: source.numberOfChannels },
      (_, channel) => source.getChannelData(channel).subarray(from, to)
    );

    if (denoising && noise) {
      channels = await settle(
        denoise(channels, rate, noise.amount, noise.profile, (f) =>
          report(isStretched(region) ? f / 2 : f)
        ),
        options.signal
      );
    }

    const speed = isStretched(region) ? region.stretch?.rate ?? 1 : 1;
    if (isStretched(region) && region.stretch) {
      channels = await settle(
        stretch(channels, region.stretch.rate, region.stretch.semitones, (f) =>
          report(denoising ? 0.5 + f / 2 : f)
        ),
        options.signal
      );
    } else if (!denoising) {
      // Untouched, but still laid into the new buffer. A copy, because the
      // source is the caller's and is read again for the next region.
      channels = channels.map((channel) => channel.slice());
    }

    segments.push(channels);

    // Where the region now sits: its offset into the segment, at the new speed.
    const regionStart = (atFrame + ((start - segStart) * rate) / speed) / rate;
    moved.push({
      ...region,
      start: regionStart,
      end: regionStart + (end - start) / speed,
      // Already applied. The graph must not stretch it again.
      stretch: undefined,
    });

    atFrame += channels[0]?.length ?? 0;
    report(1);
  }

  const prepared = new AudioBuffer({
    length: Math.max(1, atFrame),
    numberOfChannels: source.numberOfChannels,
    sampleRate: rate,
  });

  let offset = 0;
  for (const channels of segments) {
    channels.forEach((samples, channel) =>
      prepared.copyToChannel(samples, channel, offset)
    );
    offset += channels[0]?.length ?? 0;
  }

  return { source: prepared, regions: moved, stack: rest, indexShift };
}

/** Waits for a worker job, cancelling it if the user cancels the export. */
async function settle<T>(
  job: { id: number; done: Promise<T | null> },
  signal: AbortSignal | undefined
): Promise<T> {
  if (signal?.aborted) throw new RenderCancelled();

  const stop = () => cancel(job.id);
  signal?.addEventListener("abort", stop, { once: true });

  try {
    const result = await job.done;
    if (result === null) throw new RenderCancelled();
    return result;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
