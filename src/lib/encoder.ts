/**
 * The main thread's half of the encode worker.
 *
 * **One worker, created on the first export, kept for the life of the page.** No
 * pool. [The worker boundary design](../../.wayfinder/designs/worker-boundary.md)
 * section 4 rejected a pool for two reasons: the step in front of encoding is
 * serial whatever the worker does, because Web Audio cannot leave the main
 * thread; and a pool of *K* multiplies peak memory by *K*, which fights the
 * 1 GB ceiling.
 *
 * `terminate()` is deliberately never called. Terminating would kill the one
 * long-lived worker, and cancellation does not need it — the worker yields
 * often enough to read a `cancel` message.
 */

import EncodeWorker from "./encode-worker?worker";
import { BitDepth, DEFAULT_BIT_DEPTH, OutputFormat } from "./output-format";
import {
  Analysis,
  MeasureKind,
  WorkerReply,
  WorkerRequest,
} from "./encode-protocol";

type Job = {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: (fraction: number) => void;
};

/** A job the caller cancelled. Its promise resolves to `null`, it does not throw. */
export type Cancellable<T> = { id: number; done: Promise<T | null> };

let worker: Worker | null = null;
let nextId = 1;
const jobs = new Map<number, Job>();

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new EncodeWorker();
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const job = jobs.get(reply.id);
    if (!job) return;

    if ("progress" in reply) {
      job.onProgress?.(reply.progress);
      return;
    }

    jobs.delete(reply.id);

    if ("error" in reply) {
      job.reject(new Error(reply.error));
      return;
    }
    if ("cancelled" in reply) {
      (job.resolve as (value: null) => void)(null);
      return;
    }
    if ("blob" in reply) {
      (job.resolve as (value: Blob) => void)(reply.blob);
      return;
    }
    (job.resolve as (value: Analysis) => void)(reply.analysis);
  };

  // A worker that dies takes every in-flight job with it. Failing them loudly
  // beats a promise that never settles and a spinner that never stops.
  worker.onerror = (event) => {
    const error = new Error(
      `Encode worker failed: ${event.message || "unknown error"}`
    );
    for (const [id, job] of jobs) {
      jobs.delete(id);
      job.reject(error);
    }
  };

  return worker;
}

function send<T>(
  request: WorkerRequest,
  transfer: Transferable[],
  onProgress?: (fraction: number) => void
): Cancellable<T> {
  const target = ensureWorker();

  const done = new Promise<T | null>((resolve, reject) => {
    jobs.set(request.id, {
      resolve: resolve as Job["resolve"],
      reject,
      onProgress,
    });
    target.postMessage(request, transfer);
  });

  return { id: request.id, done };
}

/**
 * The channels of a buffer, ready to post.
 *
 * **Transferring detaches the whole `AudioBuffer`.** A later read of any channel
 * throws `Cannot perform Construct on a detached ArrayBuffer`. That is the
 * safety rule the design's transfer decision costs, and it is why `transfer` is
 * a parameter and not an assumption:
 *
 * > Transfer only the freshly rendered export buffer. Never a buffer anything
 * > else still reads.
 *
 * Copying is the escape hatch for a caller that needs the buffer afterwards —
 * the benchmark harness, which times the same buffer three times.
 */
function channelsOf(
  buffer: AudioBuffer,
  transfer: boolean
): { channels: Float32Array[]; transferList: Transferable[] } {
  const channels: Float32Array[] = [];
  const transferList: Transferable[] = [];

  for (let index = 0; index < buffer.numberOfChannels; index++) {
    const data = buffer.getChannelData(index);
    if (!transfer) {
      channels.push(new Float32Array(data));
      continue;
    }
    channels.push(data);
    // Two channels sharing one `ArrayBuffer` would appear twice here, and a
    // repeated entry in a transfer list is a `DataCloneError`.
    if (!transferList.includes(data.buffer)) transferList.push(data.buffer);
  }

  return { channels, transferList };
}

/**
 * Encodes one rendered region.
 *
 * The result is a `Blob`, not a URL. Whoever needs a URL makes one and revokes
 * it; nothing that is only going into a zip ever gets one at all. See
 * [018 — Export blob URLs are never revoked](../../.wayfinder/tickets/018-revoke-export-blob-urls.md).
 */
export function encode(
  buffer: AudioBuffer,
  format: OutputFormat,
  options: {
    /** Bits per stored sample, for WAV and FLAC. Defaults to 16, as it always was. */
    bitDepth?: BitDepth;
    transfer?: boolean;
    onProgress?: (fraction: number) => void;
  } = {}
): Cancellable<Blob> {
  const { channels, transferList } = channelsOf(
    buffer,
    options.transfer ?? true
  );

  return send<Blob>(
    {
      action: "encode",
      id: nextId++,
      format,
      bitDepth: options.bitDepth ?? DEFAULT_BIT_DEPTH,
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      channels,
    },
    transferList,
    options.onProgress
  );
}

/**
 * Measures a rendered pass, off the main thread.
 *
 * Always transfers. Every caller is a measuring pass whose output is thrown
 * away the moment the number comes back, so there is nothing left to detach.
 *
 * Measuring here rather than on the main thread is standing rule 7. A 45-minute
 * stereo region is 260 million samples: `Math.abs` over that many is a quarter
 * of a second of frozen page, and ITU-R BS.1770 over it is several seconds.
 */
export function analyse(
  buffer: AudioBuffer,
  kind: MeasureKind
): Cancellable<Analysis> {
  const { channels, transferList } = channelsOf(buffer, true);

  return send<Analysis>(
    {
      action: "measure",
      id: nextId++,
      kind,
      sampleRate: buffer.sampleRate,
      channels,
    },
    transferList
  );
}

/**
 * Abandons a job.
 *
 * The worker notices at its next yield and replies `cancelled`, which resolves
 * the job's promise to `null`. A job that has already finished ignores this.
 */
export function cancel(id: number): void {
  if (!worker || !jobs.has(id)) return;
  worker.postMessage({ action: "cancel", id } satisfies WorkerRequest);
}

/**
 * Drops the worker. Not used in the app — the design keeps one for the life of
 * the page. It exists so a test or a hot reload can start clean.
 */
export function dispose(): void {
  worker?.terminate();
  worker = null;
  jobs.clear();
}
