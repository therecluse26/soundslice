/**
 * Running the region tools over a real file.
 *
 * The maths is in [`silence.ts`](./silence.ts) and
 * [`transients.ts`](./transients.ts), where Vitest reads it under Node. This
 * file is the part that cannot be tested there: it decodes, it walks a
 * 45-minute track without freezing the page, and it remembers what it found.
 *
 * ## Two rules it holds
 *
 * **No audio work runs on the main thread, and anything over 300 ms shows
 * progress** — standing rule 7. Web Audio was never the freeze; our own
 * synchronous loops were, and a level scan over 119 million samples is exactly
 * that shape. So the scan is cut into chunks and the page runs between them.
 *
 * **It needs the decoded audio and it must not keep it** — ticket 007's rule and
 * what `AudioService.measureFor` already does. A decoded 45-minute stereo track
 * is 1.04 GB. What survives a call here is a list of numbers.
 */

import { AudioLoader } from "./audio-loader";
import { rmsDbWindows } from "./dsp";
import { Region } from "./edit-stack";
import {
  SilenceSettings,
  regionsFromSpans,
  silenceWindowSamples,
  spansFromLevels,
} from "./silence";
import {
  TRANSIENT_DEFAULTS,
  TransientSettings,
  onsetsFromLevels,
  refineOnset,
  transientWindowSamples,
} from "./transients";

export type ScanOptions = {
  /** 0 to 1 across the scan. */
  onProgress?: (fraction: number) => void;
};

/**
 * How many windows one chunk of the scan measures.
 *
 * At 20 ms windows that is 40 seconds of audio, which is a few milliseconds of
 * work — well under one frame — and a 45-minute track is 68 chunks. Smaller
 * chunks would spend more time handing control back than scanning.
 */
const WINDOWS_PER_CHUNK = 2000;

/**
 * Hands the page back to the browser, without the timer clamp.
 *
 * `setTimeout(0)` is clamped to about 4 ms once a few of them nest, so 68 chunks
 * would spend a quarter of a second waiting rather than working. A
 * `MessageChannel` message is a macrotask with no clamp: the browser paints and
 * handles input, then comes straight back.
 */
function yieldToPage(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Every channel of a buffer, as the plain arrays the maths reads. */
function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel)
  );
}

/**
 * The RMS level of every window of a buffer, measured a chunk at a time.
 *
 * `subarray` shares the samples rather than copying them, so cutting the scan
 * into chunks costs no memory at all.
 */
async function levelsOf(
  buffer: AudioBuffer,
  windowSamples: number,
  options: ScanOptions
): Promise<Float32Array> {
  const channels = channelsOf(buffer);
  const frames = buffer.length;
  const count = Math.max(0, Math.ceil(frames / windowSamples));
  const levels = new Float32Array(count);

  for (let window = 0; window < count; window += WINDOWS_PER_CHUNK) {
    const from = window * windowSamples;
    const to = Math.min(frames, (window + WINDOWS_PER_CHUNK) * windowSamples);

    levels.set(
      rmsDbWindows(
        channels.map((samples) => samples.subarray(from, to)),
        windowSamples
      ),
      window
    );

    options.onProgress?.(Math.min(1, (window + WINDOWS_PER_CHUNK) / count));
    await yieldToPage();
  }

  return levels;
}

/**
 * One region per non-silent stretch of this file.
 *
 * Zero regions for a silent file, one for a file with no silence in it. Both are
 * legal — ticket 021 allows a track to hold none — and neither is an error.
 */
export async function splitTrackOnSilence(
  file: File,
  settings: SilenceSettings,
  options: ScanOptions = {}
): Promise<Region[]> {
  const buffer = await AudioLoader.loadAudioFile(file);
  const windowSamples = silenceWindowSamples(buffer.sampleRate);

  const levels = await levelsOf(buffer, windowSamples, options);

  return regionsFromSpans(
    spansFromLevels(
      levels,
      windowSamples / buffer.sampleRate,
      buffer.duration,
      settings
    )
  );
}

/**
 * Where transients are remembered, keyed on the file.
 *
 * The same shape `preview-measurements.ts` uses, and for the same reason:
 * detection costs a full decode and the magnet needs the answer on every frame
 * of a drag. **Detection runs once per track, not once per drag.**
 *
 * Bounded, oldest dropped first. A list of transients is a few thousand doubles;
 * eight of them is tens of kilobytes and no audio.
 */
const transients = new Map<string, number[]>();
const detecting = new Map<string, Promise<number[]>>();

const MAX_TRANSIENT_ENTRIES = 8;

function transientKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** What is already known about this file, without starting any work. */
export function cachedTransients(file: File): number[] | undefined {
  return transients.get(transientKey(file));
}

/**
 * Every transient in this file, detecting it once if nobody has.
 *
 * Two calls while one detection is running share it, so turning the magnet on
 * for a card that is already scanning does not scan again.
 */
export function ensureTransients(
  file: File,
  settings: TransientSettings = TRANSIENT_DEFAULTS,
  options: ScanOptions = {}
): Promise<number[]> {
  const key = transientKey(file);

  const known = transients.get(key);
  if (known) return Promise.resolve(known);

  const running = detecting.get(key);
  if (running) return running;

  const work = detectFor(file, settings, options)
    .then((found) => {
      transients.set(key, found);

      while (transients.size > MAX_TRANSIENT_ENTRIES) {
        const oldest = transients.keys().next().value;
        if (oldest === undefined) break;
        transients.delete(oldest);
      }

      return found;
    })
    .finally(() => {
      detecting.delete(key);
    });

  detecting.set(key, work);
  return work;
}

/** Empties the cache. For tests, and for nothing in the app. */
export function forgetTransients(): void {
  transients.clear();
}

async function detectFor(
  file: File,
  settings: TransientSettings,
  options: ScanOptions
): Promise<number[]> {
  if (import.meta.env.DEV) countDetection(file.name);

  const buffer = await AudioLoader.loadAudioFile(file);
  const windowSamples = transientWindowSamples(buffer.sampleRate);

  const levels = await levelsOf(buffer, windowSamples, options);
  const channels = channelsOf(buffer);

  return onsetsFromLevels(levels, settings).map((window) =>
    refineOnset(channels, levels, window, windowSamples, buffer.sampleRate)
  );
}

/**
 * Counts detections, in development only.
 *
 * Ticket 026's acceptance is "detection runs once per track, not once per drag —
 * counted, not assumed". This is the counter that makes it countable, in the
 * same shape as `render-count.ts`.
 *
 * ```js
 * window.__detections   // { "clip-30s.wav": 1 }
 * ```
 */
function countDetection(name: string): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  const counts = ((window as DetectionCountWindow).__detections ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}

type DetectionCountWindow = Window & {
  __detections?: Record<string, number>;
};
