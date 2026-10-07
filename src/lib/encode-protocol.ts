/**
 * The message protocol between the main thread and the encode worker.
 *
 * Settled by [the worker boundary design](../../.wayfinder/designs/worker-boundary.md),
 * section 2. Both sides import this file, so a change to one side cannot
 * silently miss the other.
 *
 * Three messages in, five messages out. **Every message carries an `id`** — the
 * generation number from section 5. One long-lived worker serves every export,
 * so a reply with no id could not be matched to its request.
 *
 * ## One change from the design as written
 *
 * The design said `EncodeDone` carries a `url`. It carries a `Blob`.
 *
 * A blob URL pins its blob until it is revoked, and the intermediate outputs of
 * a batch export are never downloaded at all — they exist only to be put in the
 * zip. Making a URL for them creates a leak that then has to be timed away. A
 * `Blob` is cloned by reference across `postMessage`, so it costs nothing to
 * send and there is nothing to revoke. That is ticket 018's option 3, and it
 * removes the hazard rather than timing around it.
 */

import { BitDepth, OutputFormat } from "./output-format";

/** Encode one rendered region. Its `channels` are transferred, not copied. */
export type EncodeRequest = {
  action: "encode";
  id: number;
  format: OutputFormat;
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  channels: Float32Array[];

  /**
   * Bits per stored sample, for WAV and FLAC.
   *
   * MP3 and Opus ignore it — they store frequency coefficients, not samples, so
   * a bit depth means nothing to them. The main thread always sends one, so the
   * worker never has to guess a default.
   */
  bitDepth: BitDepth;
};

/**
 * What a measuring pass wants to know about its output.
 *
 * `peak` is one scan. `loudness` runs the whole of ITU-R BS.1770 — two biquads
 * per channel, 400 ms blocks at 75% overlap, two gates, and a 4× oversampling
 * true-peak filter. Asking for it when peak would do costs a great deal.
 */
export type MeasureKind = "peak" | "loudness";

/**
 * Measure a rendered pass.
 *
 * Not in the original design. An operation that sets a gain has to know what its
 * input sounded like before the next pass can be built, and scanning 260 million
 * samples on the main thread is exactly what standing rule 7 forbids. The
 * measuring pass's output is thrown away, so its channels are safe to transfer.
 */
export type MeasureRequest = {
  action: "measure";
  id: number;
  kind: MeasureKind;
  sampleRate: number;
  channels: Float32Array[];
};

/**
 * What came back.
 *
 * `peak` is always present. `lufs` and `truePeakDb` only for `kind: "loudness"`,
 * and either may be `-Infinity` for silence or for a region too short to hold one
 * 400 ms gating block.
 */
export type Analysis = {
  peak: number;
  lufs?: number;
  truePeakDb?: number;
};

/**
 * Learn a noise profile from a stretch of audio the user marked as noise.
 * Ticket 036. Its `channels` are transferred: they are a copy made for this.
 */
export type ProfileRequest = {
  action: "profile";
  id: number;
  fftSize: number;
  channels: Float32Array[];
};

/**
 * Denoise a segment, for export. Ticket 036.
 *
 * The profile's magnitudes are copied, not transferred — the edit stack keeps
 * the profile, and a transfer would detach it.
 */
export type DenoiseRequest = {
  action: "denoise";
  id: number;
  sampleRate: number;
  amount: number;
  profile: { magnitudes: Float32Array; fftSize: number; sampleRate: number };
  channels: Float32Array[];
};

/** Change a segment's speed and pitch, for export. Ticket 037. */
export type StretchRequest = {
  action: "stretch";
  id: number;
  rate: number;
  semitones: number;
  channels: Float32Array[];
};

export type CancelRequest = {
  action: "cancel";
  id: number;
};

export type WorkerRequest =
  | EncodeRequest
  | MeasureRequest
  | ProfileRequest
  | DenoiseRequest
  | StretchRequest
  | CancelRequest;

export type EncodeProgress = { id: number; progress: number };
export type EncodeDone = { id: number; blob: Blob };
export type MeasureDone = { id: number; analysis: Analysis };
export type ProfileDone = { id: number; magnitudes: Float32Array };
/** Processed audio, transferred back. One array per channel. */
export type ChannelsDone = { id: number; channels: Float32Array[] };
export type EncodeCancelled = { id: number; cancelled: true };
export type EncodeFailed = { id: number; error: string };

export type WorkerReply =
  | EncodeProgress
  | EncodeDone
  | MeasureDone
  | ProfileDone
  | ChannelsDone
  | EncodeCancelled
  | EncodeFailed;

/**
 * How much audio one chunk of encoding covers before the worker yields.
 *
 * The worker has to yield to read its inbox: ruling out `SharedArrayBuffer`
 * ruled out a flag readable mid-loop, so a busy worker is a deaf worker. This
 * number is the trade — smaller chunks cancel sooner and report progress more
 * often, larger chunks waste fewer task switches.
 *
 * 65536 frames is 1.49 s of audio at 44.1 kHz. A 5-minute file yields about 200
 * times, a 45-minute file about 1800 times.
 */
export const CHUNK_FRAMES = 65536;
