/**
 * Plain maths over `Float32Array` and plain numbers. No Web Audio, no DOM, no
 * browser.
 *
 * This module is the shape every later DSP function takes, and it is the reason
 * [006 — Install Vitest](../../.wayfinder/tickets/006-install-vitest.md) needs
 * no Web Audio polyfill and no browser test runner.
 *
 * [The edit stack design](../../.wayfinder/designs/edit-stack.md) settled it:
 * every operation is either a built-in Web Audio node — somebody else's code,
 * not ours to test — or an `AudioWorklet`. A worklet is a thin shell around a
 * plain function over `Float32Array`. So the maths lives here, where a Node test
 * can reach it, and the shell stays untested.
 *
 * Keep this module free of `AudioBuffer`. The moment it imports one, the tests
 * need a browser.
 */

/**
 * The largest absolute sample value across every channel.
 *
 * Returns 0 for silence and for no channels. A caller that divides by this
 * value must guard against 0 itself — see `peakNormalizationGain`.
 */
export function maxAmplitude(channels: Float32Array[]): number {
  let peak = 0;

  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }

  return peak;
}

/** Decibels to a linear multiplier. 0 dB is 1, −6 dB is about 0.5. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** A linear multiplier back to decibels. Silence reports −Infinity. */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/**
 * The gain that lifts a signal whose loudest sample is `peak` to `targetDbfs`.
 *
 * Silence returns 1, not Infinity. A silent region stays silent instead of
 * becoming a buffer full of `NaN`.
 *
 * At `targetDbfs` of 0 this is `1 / peak`, which is exactly what the old
 * `normalize` in `audio-processors.ts` computed.
 */
export function peakNormalizationGain(
  peak: number,
  targetDbfs: number
): number {
  if (!(peak > 0)) return 1;
  return dbToGain(targetDbfs) / peak;
}

/**
 * Where a region's fade-in ends and its fade-out starts, in seconds from the
 * start of the region.
 *
 * **The two fades are shortened together when they will not fit.** A 30 ms
 * region with 20 ms fades gets 15 ms of each, not 20 ms of overlap. The old
 * per-sample loop in `audio-trimmer.ts` did not check: it multiplied the same
 * sample by both factors and produced a dip in the middle. A region cannot be
 * under 5 seconds in the UI today, so that has never fired.
 *
 * A region of zero length reports both edges at 0.
 */
export function fadeTimes(
  durationSec: number,
  inMs: number,
  outMs: number
): { fadeInEnd: number; fadeOutStart: number } {
  if (!(durationSec > 0)) return { fadeInEnd: 0, fadeOutStart: 0 };

  let fadeIn = Math.max(0, inMs) / 1000;
  let fadeOut = Math.max(0, outMs) / 1000;
  const total = fadeIn + fadeOut;

  if (total > durationSec) {
    const scale = durationSec / total;
    fadeIn *= scale;
    fadeOut *= scale;
  }

  return { fadeInEnd: fadeIn, fadeOutStart: durationSec - fadeOut };
}

/**
 * The RMS level of each fixed-length window, in dBFS, across every channel.
 *
 * One number per window, so a 45-minute track at 20 ms windows is 135,000
 * numbers rather than 119 million samples. Everything that has to find quiet
 * parts or sudden loud parts reads this instead of the samples.
 *
 * **RMS, not peak.** A peak reacts to one stray sample, so a single click in a
 * silent room would read as speech. RMS over a window is how a noise gate hears
 * it, and it is what makes a −40 dBFS threshold mean what a user expects.
 *
 * Silence reads `-Infinity`, not `0`. A comparison against a threshold is then
 * correct with no special case, which `NaN` would not be.
 *
 * The last window is kept even when it is short. Dropping it would lose up to
 * one window of audio at the end of every file.
 */
export function rmsDbWindows(
  channels: Float32Array[],
  windowSamples: number
): Float32Array {
  const frames = channels[0]?.length ?? 0;
  const size = Math.max(1, Math.floor(windowSamples));
  const count = frames === 0 ? 0 : Math.ceil(frames / size);
  const levels = new Float32Array(count);

  for (let window = 0; window < count; window++) {
    const from = window * size;
    const to = Math.min(from + size, frames);

    let sum = 0;
    for (const samples of channels) {
      for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    }

    const mean = sum / Math.max(1, (to - from) * channels.length);
    levels[window] = mean > 0 ? 10 * Math.log10(mean) : -Infinity;
  }

  return levels;
}

/**
 * How many frames a region occupies at a given sample rate.
 *
 * Rounded, not truncated. `createBuffer` in the old trimmer took
 * `duration * sampleRate` and let the constructor truncate, so a region could
 * lose its last frame. Never audible; it did make two runs on two machines
 * differ by a frame, which standing rule 1 forbids.
 *
 * Always at least 1. `OfflineAudioContext` rejects a length of 0.
 */
export function regionFrameCount(
  startSec: number,
  endSec: number,
  sampleRate: number
): number {
  const frames = Math.round((endSec - startSec) * sampleRate);
  return Math.max(1, frames);
}
