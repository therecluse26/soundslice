/**
 * The spectral DSP: **noise reduction** (ticket 036) and **time and pitch**
 * (ticket 037), in one self-contained function.
 *
 * ## Why one function, and why it references nothing outside itself
 *
 * Two places run this code, and they must run the *same* code:
 *
 * | Where | How it gets the code |
 * |---|---|
 * | the encode worker, for export | an ordinary import |
 * | an `AudioWorklet`, for preview | `spectralKit.toString()`, as the worklet's source |
 *
 * A worklet module cannot import from the app's bundle, and a second copy of an
 * STFT would drift from the first in exactly the ways ADR 0001 forbids — the
 * preview would not be what the export writes. So the worklet is *built from*
 * this function's source text. That only works if the function is
 * **self-contained**: everything it calls is defined inside it, and it uses
 * nothing but `Math` and typed arrays. No imports, no module-level helpers, no
 * classes — a bundler lowers class fields into calls to its own helpers, and
 * those helpers would not exist in the worklet.
 *
 * ## Why not a worklet in the export as well
 *
 * `addModule` on an `OfflineAudioContext` leaks the whole context in Chromium —
 * 322 MB over 30 renders, measured in ticket 019. Export therefore runs these
 * as plain loops in the encode worker, *before* the Web Audio graph, and only
 * the live preview context ever loads a worklet.
 *
 * Plain maths, no Web Audio. Vitest reads it under Node.
 */

/** The window every STFT here uses, in samples. 43 ms at 48 kHz. */
export const SPECTRAL_FFT_SIZE = 2048;

export function spectralKit() {
  /** cos and sin of 2πk/n for k below n/2, by n. Made once per size. */
  const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();

  function twiddlesFor(n: number) {
    let table = twiddles.get(n);
    if (!table) {
      const cos = new Float64Array(n / 2);
      const sin = new Float64Array(n / 2);
      for (let k = 0; k < n / 2; k++) {
        cos[k] = Math.cos((2 * Math.PI * k) / n);
        sin[k] = Math.sin((2 * Math.PI * k) / n);
      }
      table = { cos, sin };
      twiddles.set(n, table);
    }
    return table;
  }

  /** In-place radix-2 FFT. `inverse` divides by `n`. */
  function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = re.length;
    const table = twiddlesFor(n);
    const sign = inverse ? 1 : -1;

    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k++) {
          const wr = table.cos[k * step];
          const wi = sign * table.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  /** A periodic Hann window, optionally square-rooted. */
  function hann(n: number, root: boolean): Float64Array {
    const window = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const value = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      window[i] = root ? Math.sqrt(value) : value;
    }
    return window;
  }

  /**
   * Runs a streaming processor over a whole channel, with its latency removed.
   *
   * Every processor here is a FIFO with a fixed latency. Offline there is no
   * reason to keep it: feed the signal and then `latency` zeros, and drop the
   * first `latency` samples of what comes out. The result lines up with the
   * input to the sample.
   */
  function runOffline(
    processor: { latency: number; process: (input: Float32Array, output: Float32Array) => void },
    input: Float32Array
  ): Float32Array {
    const padded = new Float32Array(input.length + processor.latency);
    padded.set(input);
    const out = new Float32Array(padded.length);
    processor.process(padded, out);
    return out.slice(processor.latency);
  }

  /**
   * The average magnitude spectrum of a stretch of audio. **The noise profile.**
   *
   * Every channel and every half-overlapping frame are averaged together. The
   * frames are windowed with the same square-root Hann the denoiser analyses
   * with, so the profile and the signal it is compared with are measured the
   * same way — a profile taken with a different window would read every bin a
   * few per cent high or low, and subtract the wrong amount.
   */
  function noiseSpectrum(channels: Float32Array[], fftSize: number): Float32Array {
    const bins = fftSize / 2 + 1;
    const sum = new Float64Array(bins);
    const window = hann(fftSize, true);
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    let frames = 0;

    for (const samples of channels) {
      const hop = fftSize / 2;
      const last = Math.max(0, samples.length - fftSize);
      for (let start = 0; start <= last; start += hop) {
        for (let i = 0; i < fftSize; i++) {
          re[i] = (samples[start + i] ?? 0) * window[i];
          im[i] = 0;
        }
        fft(re, im, false);
        for (let k = 0; k < bins; k++) sum[k] += Math.hypot(re[k], im[k]);
        frames++;
      }
    }

    const profile = new Float32Array(bins);
    for (let k = 0; k < bins; k++) profile[k] = frames > 0 ? sum[k] / frames : 0;
    return profile;
  }

  /**
   * A profile measured at one rate, read at another.
   *
   * Bin *k* means a different frequency at a different rate, so the profile is
   * re-read by frequency, linearly between bins. Above the old Nyquist the top
   * bin repeats: there is no measurement there, and the last one is the
   * nearest guess.
   */
  function resampleProfile(
    magnitudes: Float32Array,
    fromRate: number,
    toRate: number
  ): Float32Array {
    if (fromRate === toRate) return magnitudes;

    const bins = magnitudes.length;
    const out = new Float32Array(bins);
    const last = bins - 1;

    for (let k = 0; k < bins; k++) {
      const at = (k * toRate) / fromRate;
      if (at >= last) {
        out[k] = magnitudes[last];
        continue;
      }
      const below = Math.floor(at);
      const t = at - below;
      out[k] = magnitudes[below] * (1 - t) + magnitudes[below + 1] * t;
    }

    return out;
  }

  /**
   * A streaming **spectral subtraction** denoiser for one channel.
   *
   * Square-root Hann analysis and synthesis at 75% overlap, which sums to a
   * constant, so a gain of 1 everywhere gives the input back. For each bin:
   *
   * ```
   * gain = max(floor, 1 − over × noise / |X|)
   * ```
   *
   * - `over` is 1 + amount: subtracting a little more than the average noise
   *   catches the frames where noise runs above its average.
   * - `floor` is how far a bin may be turned down: 24 dB × amount. Never zero —
   *   a bin switched fully off and on again is the "musical noise" warble that
   *   gives cheap noise reduction away.
   * - The gain is smoothed over time, 60/40 with the last frame, for the same
   *   reason.
   *
   * `amount` 0 is a pure delay — the gain is 1 in every bin.
   */
  function createDenoiser(fftSize: number, noise: Float32Array, amount: number) {
    const n = fftSize;
    const hop = n / 4;
    const latency = n - hop;
    const bins = n / 2 + 1;
    const window = hann(n, true);
    // Square-root Hann twice is Hann, and Hann at a quarter-window hop sums to 2.
    const scale = (2 * hop) / n;

    const clamped = Math.min(1, Math.max(0, amount));
    const floor = Math.pow(10, (-24 * clamped) / 20);
    const over = 1 + clamped;

    const inFifo = new Float32Array(n);
    const outFifo = new Float32Array(n);
    const accum = new Float64Array(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const previous = new Float64Array(bins).fill(1);
    let rover = latency;

    function frame(): void {
      for (let i = 0; i < n; i++) {
        re[i] = inFifo[i] * window[i];
        im[i] = 0;
      }
      fft(re, im, false);

      for (let k = 0; k < bins; k++) {
        const magnitude = Math.hypot(re[k], im[k]);
        let gain = 1 - (over * noise[k]) / (magnitude + 1e-12);
        if (gain < floor) gain = floor;
        if (gain > 1) gain = 1;
        gain = 0.6 * gain + 0.4 * previous[k];
        previous[k] = gain;

        re[k] *= gain;
        im[k] *= gain;
        if (k > 0 && k < n / 2) {
          re[n - k] *= gain;
          im[n - k] *= gain;
        }
      }

      fft(re, im, true);

      for (let i = 0; i < n; i++) accum[i] += re[i] * window[i] * scale;
      for (let i = 0; i < hop; i++) outFifo[i] = accum[i];
      accum.copyWithin(0, hop);
      accum.fill(0, n - hop);
      inFifo.copyWithin(0, hop);
    }

    return {
      // What comes out lags what goes in by one whole window. The FIFO starts
      // `latency` in, and a sample then waits one more hop for its frame to be
      // processed before the output FIFO hands it back. Measured with an
      // impulse; `spectral.test.ts` holds it there.
      latency: n,
      process(input: Float32Array, output: Float32Array): void {
        for (let i = 0; i < input.length; i++) {
          inFifo[rover] = input[i];
          output[i] = outFifo[rover - latency];
          rover++;
          if (rover >= n) {
            rover = latency;
            frame();
          }
        }
      },
    };
  }

  /**
   * A streaming **pitch shifter** for one channel. Duration does not change.
   *
   * The phase vocoder Stephan Bernsee published as `smbPitchShift`: measure each
   * bin's true frequency from its phase advance, move the bin to the frequency
   * times the shift, and rebuild the phase from there. Hann windows at 4× overlap.
   *
   * 0 semitones is the input back, delayed by `latency`, to within rounding.
   */
  function createPitchShifter(fftSize: number, semitones: number) {
    const n = fftSize;
    const osamp = 4;
    const hop = n / osamp;
    const latency = n - hop;
    const bins = n / 2 + 1;
    const factor = Math.pow(2, semitones / 12);
    const expected = (2 * Math.PI * hop) / n;
    const window = hann(n, false);
    // Hann twice at 4× overlap sums to 1.5. This puts the level back to 1.
    const scale = 1 / (0.375 * osamp);

    const inFifo = new Float32Array(n);
    const outFifo = new Float32Array(n);
    const accum = new Float64Array(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const lastPhase = new Float64Array(bins);
    const sumPhase = new Float64Array(bins);
    const anaMagn = new Float64Array(bins);
    const anaFreq = new Float64Array(bins);
    const synMagn = new Float64Array(bins);
    const synFreq = new Float64Array(bins);
    let rover = latency;

    function frame(): void {
      for (let i = 0; i < n; i++) {
        re[i] = inFifo[i] * window[i];
        im[i] = 0;
      }
      fft(re, im, false);

      for (let k = 0; k < bins; k++) {
        const magnitude = 2 * Math.hypot(re[k], im[k]);
        const phase = Math.atan2(im[k], re[k]);
        let delta = phase - lastPhase[k];
        lastPhase[k] = phase;
        delta -= k * expected;
        // Wrap to −π…π.
        delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
        anaMagn[k] = magnitude;
        anaFreq[k] = k + (osamp * delta) / (2 * Math.PI);
      }

      synMagn.fill(0);
      synFreq.fill(0);
      for (let k = 0; k < bins; k++) {
        const index = Math.round(k * factor);
        if (index < bins) {
          synMagn[index] += anaMagn[k];
          synFreq[index] = anaFreq[k] * factor;
        }
      }

      for (let k = 0; k < bins; k++) {
        const delta = ((synFreq[k] - k) * 2 * Math.PI) / osamp + k * expected;
        sumPhase[k] += delta;
        re[k] = synMagn[k] * Math.cos(sumPhase[k]);
        im[k] = synMagn[k] * Math.sin(sumPhase[k]);
      }
      for (let k = bins; k < n; k++) {
        re[k] = 0;
        im[k] = 0;
      }
      // DC and Nyquist were doubled with everything else, and have no mirror.
      re[0] /= 2;
      re[n / 2] /= 2;

      fft(re, im, true);

      for (let i = 0; i < n; i++) accum[i] += re[i] * window[i] * scale;
      for (let i = 0; i < hop; i++) outFifo[i] = accum[i];
      accum.copyWithin(0, hop);
      accum.fill(0, n - hop);
      inFifo.copyWithin(0, hop);
    }

    return {
      // What comes out lags what goes in by one whole window. The FIFO starts
      // `latency` in, and a sample then waits one more hop for its frame to be
      // processed before the output FIFO hands it back. Measured with an
      // impulse; `spectral.test.ts` holds it there.
      latency: n,
      process(input: Float32Array, output: Float32Array): void {
        for (let i = 0; i < input.length; i++) {
          inFifo[rover] = input[i];
          output[i] = outFifo[rover - latency];
          rover++;
          if (rover >= n) {
            rover = latency;
            frame();
          }
        }
      },
    };
  }

  /**
   * **Varispeed**: plays a channel `rate` times as fast, by resampling.
   *
   * Speed and pitch move together, the way tape does. A windowed sinc, 16 taps
   * each side under a Blackman window, with its cut-off lowered when speeding up
   * so nothing above the new Nyquist folds back down as aliasing.
   */
  function varispeed(input: Float32Array, rate: number): Float32Array {
    if (rate === 1) return input.slice();

    const taps = 16;
    const cutoff = Math.min(1, 1 / rate);
    const length = Math.max(1, Math.floor(input.length / rate));
    const out = new Float32Array(length);

    for (let j = 0; j < length; j++) {
      const position = j * rate;
      const centre = Math.floor(position);
      let sum = 0;
      let weight = 0;

      for (let t = -taps + 1; t <= taps; t++) {
        const index = centre + t;
        const distance = position - index;
        const x = Math.PI * cutoff * distance;
        const sinc = x === 0 ? 1 : Math.sin(x) / x;
        const w = distance / taps;
        if (w <= -1 || w >= 1) continue;
        const blackman =
          0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
        const h = sinc * blackman;
        weight += h;
        if (index >= 0 && index < input.length) sum += input[index] * h;
      }

      out[j] = weight > 0 ? sum / weight : 0;
    }

    return out;
  }

  /**
   * Time and pitch for one channel: `rate` times the speed, `semitones` up.
   *
   * Varispeed first, which moves the pitch by `12·log₂(rate)` semitones as a
   * side effect, then a pitch shift by whatever is left to reach `semitones`.
   * So speed 2 and 0 semitones is varispeed up an octave and a shift back down
   * an octave: twice as fast at the same pitch.
   */
  function stretchChannel(
    input: Float32Array,
    rate: number,
    semitones: number,
    fftSize: number
  ): Float32Array {
    const sped = varispeed(input, rate);
    const remaining = semitones - 12 * Math.log2(rate);
    if (Math.abs(remaining) < 1e-6) return sped;
    return runOffline(createPitchShifter(fftSize, remaining), sped);
  }

  return {
    fft,
    noiseSpectrum,
    resampleProfile,
    createDenoiser,
    createPitchShifter,
    varispeed,
    stretchChannel,
    runOffline,
  };
}

export type SpectralKit = ReturnType<typeof spectralKit>;
