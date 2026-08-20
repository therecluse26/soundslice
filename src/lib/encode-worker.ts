/**
 * The encode worker. One of them, for the life of the page.
 *
 * [The worker boundary design](../../.wayfinder/designs/worker-boundary.md)
 * settled what runs here: **encoding, and nothing else**. Web Audio is
 * `[Exposed=Window]`, so no node graph can run off the main thread. Measured in
 * Chromium 146 inside a dedicated worker: `OfflineAudioContext`, `AudioContext`
 * and `AudioBuffer` are all `undefined`.
 *
 * What this file replaces spawned a fresh worker per file per export, copied
 * every channel into the message, and called `terminate()` nowhere. Ten files
 * spawned ten workers and leaked all ten.
 *
 * ## Yielding
 *
 * A busy worker does not see incoming messages. It reads its inbox only when it
 * yields. `SharedArrayBuffer` would have given a flag readable mid-loop, and the
 * design rules it out: it needs COOP and COEP headers, and GitHub Pages sets no
 * custom headers.
 *
 * So every loop here yields every `CHUNK_FRAMES` frames. The yield is a
 * `MessageChannel` round trip, **not** `setTimeout(0)`: Chromium clamps a nested
 * `setTimeout(0)` to 1 ms, and a 5-minute file yields about 200 times, so the
 * clamp alone would cost 200 ms of doing nothing.
 */

import { Shine } from "@toots/shine.js";
import { OutputFormat, FORMAT_MIME } from "./output-format";
import { mp3BitrateFor } from "./audio-format";
import {
  Analysis,
  CHUNK_FRAMES,
  EncodeRequest,
  MeasureRequest,
  WorkerRequest,
} from "./encode-protocol";
import { integratedLoudness, truePeakDb } from "./loudness";
import {
  WavPlan,
  wavByteLength,
  writeWavFrames,
  writeWavHeader,
} from "./wav";

/** Ids the main thread has abandoned. Checked at every yield point. */
const cancelled = new Set<number>();

/** MPEG-1 Layer 3 frame size. `shine.encode` expects whole frames. */
const MP3_FRAME = 1152;

/**
 * What Opus is encoded at, in bits per second.
 *
 * 128 kbps is transparent for stereo music by every listening test Xiph
 * publishes, and it is about a tenth of a 16-bit WAV. There is no control for
 * it: ticket 011 asked for four formats, a bit depth and a sample rate, and a
 * fifth number the user must judge by ear is not one of them.
 */
const OPUS_BITRATE = 128_000;

const yieldChannel = new MessageChannel();

/**
 * Hands the event loop back for one task, so a `cancel` message can land.
 *
 * A message already queued for this worker is dispatched before the one this
 * function posts to itself, because both sit in the same task queue and the
 * earlier one was queued first.
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    yieldChannel.port1.onmessage = () => resolve();
    yieldChannel.port2.postMessage(null);
  });
}

function post(message: unknown): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.action === "cancel") {
    cancelled.add(request.id);
    return;
  }

  try {
    if (request.action === "measure") {
      await handleMeasure(request);
      return;
    }
    await handleEncode(request);
  } catch (error) {
    post({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cancelled.delete(request.id);
  }
};

async function handleMeasure(request: MeasureRequest): Promise<void> {
  const { id, kind, sampleRate, channels } = request;
  let peak = 0;

  for (const samples of channels) {
    for (let offset = 0; offset < samples.length; offset += CHUNK_FRAMES) {
      const end = Math.min(offset + CHUNK_FRAMES, samples.length);
      for (let i = offset; i < end; i++) {
        const magnitude = Math.abs(samples[i]);
        if (magnitude > peak) peak = magnitude;
      }
      await nextTask();
      if (cancelled.has(id)) {
        post({ id, cancelled: true });
        return;
      }
    }
  }

  if (kind === "peak") {
    post({ id, analysis: { peak } });
    return;
  }

  // ITU-R BS.1770 in one go. It cannot yield partway through — the filters are
  // stateful across the whole signal — so a cancel arriving now waits for it.
  // On a 45-minute track that is a few seconds, and it runs off the main thread.
  const analysis: Analysis = {
    peak,
    lufs: integratedLoudness(channels, sampleRate),
    truePeakDb: truePeakDb(channels, sampleRate),
  };

  await nextTask();
  if (cancelled.has(id)) {
    post({ id, cancelled: true });
    return;
  }

  post({ id, analysis });
}

async function handleEncode(request: EncodeRequest): Promise<void> {
  const blob = await encodeFor(request);

  // `null` is the encoder's way of saying "cancelled". The reply has already
  // been posted by whichever loop noticed.
  if (blob) post({ id: request.id, blob });
}

function encodeFor(request: EncodeRequest): Promise<Blob | null> {
  switch (request.format) {
    case OutputFormat.WAV:
      return encodeWav(request);
    case OutputFormat.MP3:
      return encodeMp3(request);
    case OutputFormat.FLAC:
    case OutputFormat.OPUS:
      return encodeMuxed(request);
  }
}

/**
 * PCM WAV at 16 or 24 bits, written by hand.
 *
 * The header and the sample maths live in [`wav.ts`](./wav.ts), so Vitest can
 * read them in plain `node`. This function is the chunking and the yielding —
 * the two things a worker adds and a test does not want.
 */
async function encodeWav(request: EncodeRequest): Promise<Blob | null> {
  const { id, channels, numberOfChannels, sampleRate, length, bitDepth } =
    request;

  const plan: WavPlan = { numberOfChannels, sampleRate, length, bitDepth };
  const wavBuffer = new ArrayBuffer(wavByteLength(plan));
  const view = new DataView(wavBuffer);

  writeWavHeader(view, plan);

  for (let frame = 0; frame < length; frame += CHUNK_FRAMES) {
    const end = Math.min(frame + CHUNK_FRAMES, length);

    writeWavFrames(view, plan, channels, frame, end);

    post({ id, progress: end / length });
    await nextTask();
    if (cancelled.has(id)) {
      post({ id, cancelled: true });
      return null;
    }
  }

  return new Blob([wavBuffer], { type: FORMAT_MIME[OutputFormat.WAV] });
}

/**
 * MP3 at 320 kbps through `shine.js`.
 *
 * Baselines finding 5: this is the single slowest stage in the app — 35 s for a
 * 45-minute file, about 7× the WAV writer. `shine.js` is pure JavaScript, and
 * [ticket 004](../../.wayfinder/tickets/004-research-webcodecs-audioencoder.md)
 * proved no browser will ever encode MP3 through WebCodecs. So it stays, and
 * this is the loop that most needs to yield.
 *
 * The Int16 conversion is done one frame at a time rather than in two
 * full-length arrays up front. The values are identical; the peak allocation is
 * two arrays of 1152 instead of two arrays of the whole file.
 */
async function encodeMp3(request: EncodeRequest): Promise<Blob | null> {
  const { id, channels, numberOfChannels, sampleRate, length } = request;

  await Shine.initialized;

  const shine = new Shine({
    samplerate: sampleRate,
    // 320 kbps is an MPEG-1 bitrate, and MPEG-1 stops at 32 kHz. A lower rate
    // must use the MPEG-2 table, which stops at 160. Asking for 320 there is
    // "Invalid configuration" and no file at all.
    bitrate: mp3BitrateFor(sampleRate),
    channels: numberOfChannels,
  });

  const leftSource = channels[0];
  const rightSource = numberOfChannels > 1 ? channels[1] : channels[0];

  const left = new Int16Array(MP3_FRAME);
  const right = new Int16Array(MP3_FRAME);
  const parts: Uint8Array[] = [];

  let sinceYield = 0;

  for (let frame = 0; frame < length; frame += MP3_FRAME) {
    const count = Math.min(MP3_FRAME, length - frame);

    for (let i = 0; i < count; i++) {
      const l = leftSource[frame + i];
      const r = rightSource[frame + i];
      left[i] = Math.round(Math.max(-1, Math.min(1, l)) * 0x7fff);
      right[i] = Math.round(Math.max(-1, Math.min(1, r)) * 0x7fff);
    }

    parts.push(
      Uint8Array.from(
        shine.encode([left.subarray(0, count), right.subarray(0, count)])
      )
    );

    sinceYield += count;
    if (sinceYield >= CHUNK_FRAMES) {
      sinceYield = 0;
      post({ id, progress: (frame + count) / length });
      await nextTask();
      if (cancelled.has(id)) {
        post({ id, cancelled: true });
        return null;
      }
    }
  }

  parts.push(Uint8Array.from(shine.close()));

  return new Blob(parts, { type: FORMAT_MIME[OutputFormat.MP3] });
}

/**
 * FLAC and Opus, through mediabunny.
 *
 * Two formats, one function, because they differ only in which encoder and
 * which container they name. Everything else — feeding the samples in chunks,
 * yielding, reporting progress, cancelling — is the same work.
 *
 * ## Why a library at all
 *
 * `AudioEncoder` hands back bare codec packets. RFC 6716 says an Opus packet's
 * framing "is not self-delimiting" and assumes a container will carry the
 * length, so writing the packets to a file end to end gives a file nothing can
 * decode. FLAC needs its `fLaC` magic and a STREAMINFO block in front of the
 * frames. Both are container work, and container work is where hand-rolling
 * costs weeks.
 *
 * ## Why WebM and not `.opus`
 *
 * A `.opus` file is Opus in Ogg, and Ogg needs the `OpusHead` header that only
 * `opus: { format: "ogg" }` produces. **No engine implements it** — Chrome and
 * Safari throw, Firefox ignores it — so the header is never emitted and the Ogg
 * muxer refuses. WebM asks for none of it. Ticket 004 verified this in engine
 * source rather than in documentation.
 *
 * ## Both imports are dynamic
 *
 * mediabunny is 8.7 MB unpacked and the FLAC encoder carries libFLAC compiled to
 * WASM. A user exporting WAV or MP3 downloads neither. That is standing rule 6
 * applied to a dependency, the same way JSZip arrives on the click.
 */
async function encodeMuxed(request: EncodeRequest): Promise<Blob | null> {
  const { id, format, channels, numberOfChannels, sampleRate, length } = request;

  const {
    AudioSample,
    AudioSampleSource,
    BufferTarget,
    FlacOutputFormat,
    Output,
    Quality,
    WebMOutputFormat,
    canEncodeAudio,
  } = await import("mediabunny");

  const flac = format === OutputFormat.FLAC;

  if (flac && !(await canEncodeAudio("flac"))) {
    // Always, on every browser. Chromium has no FLAC encoder, Firefox allows
    // only Opus and Vorbis, and WebKit answers "FLAC encoding is not supported"
    // in as many words. The check is here anyway, so a browser that gains one
    // is used instead of ignored.
    const { registerFlacEncoder } = await import("@mediabunny/flac-encoder");
    registerFlacEncoder();
  }

  const source = new AudioSampleSource(
    flac
      ? {
          codec: "flac",
          // FLAC's depth is set by the format the samples arrive in: `s16`
          // gives 16 bits, `s32` gives 24. There is no `s24`.
          transform: { sampleFormat: request.bitDepth === 24 ? "s32" : "s16" },
        }
      : { codec: "opus", quality: new Quality({ bitrate: OPUS_BITRATE }) }
  );

  const target = new BufferTarget();
  const output = new Output({
    format: flac ? new FlacOutputFormat() : new WebMOutputFormat(),
    target,
  });

  output.addAudioTrack(source);
  await output.start();

  for (let frame = 0; frame < length; frame += CHUNK_FRAMES) {
    const end = Math.min(frame + CHUNK_FRAMES, length);
    const count = end - frame;

    // A fresh array per chunk, not one reused buffer. `AudioSample` holds the
    // bytes it is given until it is closed, and the encoder reads them after
    // this loop has moved on. 512 KB per chunk is the price of not racing it.
    const planes = new Float32Array(count * numberOfChannels);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      planes.set(channels[channel].subarray(frame, end), channel * count);
    }

    const sample = new AudioSample({
      data: planes,
      format: "f32-planar",
      numberOfChannels,
      sampleRate,
      timestamp: frame / sampleRate,
    });

    // Awaited, so the encoder's own backpressure sets the pace. Without it a
    // 45-minute region queues every chunk at once and the encoder's queue holds
    // the whole track a second time.
    await source.add(sample);
    sample.close();

    post({ id, progress: end / length });
    await nextTask();
    if (cancelled.has(id)) {
      await output.cancel();
      post({ id, cancelled: true });
      return null;
    }
  }

  // Flushes the encoder and writes the container's headers. For FLAC that is
  // where STREAMINFO gets its real sample count, so this is not optional.
  await output.finalize();

  return new Blob([target.buffer as ArrayBuffer], {
    type: FORMAT_MIME[format],
  });
}
