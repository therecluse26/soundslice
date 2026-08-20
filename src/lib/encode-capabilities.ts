/**
 * What this browser can encode natively.
 *
 * Only one format asks the question: **Opus**. WAV is written by hand, MP3 is
 * `shine.js`, and FLAC is libFLAC in WASM — all three work everywhere and none
 * of them needs a probe.
 *
 * ## Detect the config, never the codec string
 *
 * Ticket 004 read three engines' source. Support varies by operating system, by
 * channel count, by sample rate and — on Windows — by bitrate. A bare "does this
 * browser do Opus" tells you nothing about the encode you are about to start, so
 * this file probes the exact `AudioEncoderConfig` it will use.
 *
 * ## Three ways to be told no
 *
 * 1. `isConfigSupported` resolves `{ supported: false }` — a well-formed config
 *    naming something the engine will not encode.
 * 2. It rejects with `TypeError` — the config is structurally broken.
 * 3. It rejects with `NotSupportedError` — Chromium throws this while *parsing*
 *    certain Opus options, before it ever gets to checking support.
 *
 * And a fourth: `AudioEncoder` may not exist at all. It is absent on Firefox
 * Android, on Safari before 26, in any non-secure context, and in any Firefox
 * with `privacy.resistFingerprinting` on. So the `typeof` guard comes first and
 * the `try` wraps everything after it.
 */

/** What Opus is offered at: 48 kHz stereo, 128 kbps. */
export const OPUS_ENCODER_CONFIG: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: 48000,
  numberOfChannels: 2,
  bitrate: 128000,
};

/**
 * True when this browser will encode exactly this config.
 *
 * Safe in a worker and on the main thread — `AudioEncoder` is exposed in both,
 * which is the one part of the media stack that is. Web Audio is not.
 */
export async function canEncode(config: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;

  try {
    const { supported } = await AudioEncoder.isConfigSupported(config);
    // `supported` is optional in the specification, so `=== true` and not a
    // truthiness check: an engine that answers nothing has not said yes.
    return supported === true;
  } catch {
    return false;
  }
}

/**
 * True when Opus can be offered.
 *
 * Asked once and remembered. The answer cannot change while the page is open,
 * and the Export section asks on every render.
 */
let opusProbe: Promise<boolean> | null = null;

export function canEncodeOpus(): Promise<boolean> {
  if (!opusProbe) opusProbe = canEncode(OPUS_ENCODER_CONFIG);
  return opusProbe;
}
