/**
 * Loudness, per ITU-R BS.1770-5 Annex 1, and true peak, per Annex 2.
 *
 * Plain maths over `Float32Array`. No Web Audio, no DOM — the rule `dsp.ts`
 * states, and the reason every number below is checked by a Node test against
 * the EBU Tech 3341 vectors.
 *
 * The whole of this file is the answer to
 * [005 — Research: LUFS loudness per ITU-R BS.1770](../../.wayfinder/research/lufs-bs1770.md),
 * which is on the `research/lufs-bs1770` branch. That research did two things
 * this file could not have done for itself:
 *
 * 1. **It closed the 44.1 kHz gap.** The specification publishes K-weighting
 *    coefficients for 48 kHz only, and does not say how to re-derive them. The
 *    research inverted the published coefficients back to their analog
 *    prototype, checked the result against `libebur128`, and regenerated the
 *    48 kHz table to about fourteen digits. `kWeighting` below is that.
 * 2. **It ran the test vectors** rather than quoting them, at 48 kHz and at
 *    44.1 kHz.
 *
 * ## Peak normalization is not this
 *
 * `peakNormalizationGain` in `dsp.ts` divides by the loudest single sample. Two
 * tracks can share a peak and sound nothing alike. Both stay: `CONTEXT.md`
 * separates the terms, and they are different tools.
 */

/** One second-order section. `y[n] = b0x[n] + b1x[n-1] + b2x[n-2] − a1y[n-1] − a2y[n-2]`. */
export type Biquad = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

/**
 * The analog prototype of BS.1770 stage 1, a high shelf modelling a rigid
 * spherical head.
 *
 * These constants match `ebur128_init_filter()` in `libebur128`, and the
 * research confirmed them independently by inverting the published 48 kHz
 * table.
 */
const SHELF_F0 = 1681.974450955533;
const SHELF_Q = 0.7071752369554196;
const SHELF_GAIN_DB = 3.999843853973347;

/** The analog prototype of BS.1770 stage 2, the RLB high pass. */
const HIGH_PASS_F0 = 38.13547087602444;
const HIGH_PASS_Q = 0.5003270373238773;

/**
 * The calibration offset in BS.1770 equation 2.
 *
 * It cancels the K-weighting gain at 997 Hz, which is why a 0 dBFS 997 Hz sine
 * on one channel reads exactly −3.01 LKFS. It is not psychoacoustic and it has
 * been there since BS.1770-0 in 2006, before gating existed.
 */
const OFFSET_DB = -0.691;

/** BS.1770-5 Annex 1: a gating block is 400 ms, overlapping by 75%. */
const BLOCK_SECONDS = 0.4;
const OVERLAP = 0.75;

/** The absolute gate, in LUFS. Blocks quieter than this are never counted. */
const ABSOLUTE_GATE_LUFS = -70;

/** The relative gate, in LU below the absolute-gated loudness. */
const RELATIVE_GATE_LU = -10;

/**
 * The stage 1 high shelf at a given rate.
 *
 * `Math.tan` **is** the pre-warping. It maps the analog corner onto the same
 * digital corner at any rate, which is exactly the "same frequency response"
 * the specification asks for and does not explain how to get.
 */
export function kWeightingShelf(sampleRate: number): Biquad {
  const K = Math.tan((Math.PI * SHELF_F0) / sampleRate);
  const Vh = Math.pow(10, SHELF_GAIN_DB / 20);
  const Vb = Math.pow(Vh, 0.499666774155);
  const D = 1 + K / SHELF_Q + K * K;

  return {
    b0: (Vh + (Vb * K) / SHELF_Q + K * K) / D,
    b1: (2 * (K * K - Vh)) / D,
    b2: (Vh - (Vb * K) / SHELF_Q + K * K) / D,
    a1: (2 * (K * K - 1)) / D,
    a2: (1 - K / SHELF_Q + K * K) / D,
  };
}

/** The stage 2 RLB high pass at a given rate. */
export function kWeightingHighPass(sampleRate: number): Biquad {
  const K = Math.tan((Math.PI * HIGH_PASS_F0) / sampleRate);
  const D = 1 + K / HIGH_PASS_Q + K * K;

  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / D,
    a2: (1 - K / HIGH_PASS_Q + K * K) / D,
  };
}

/**
 * The per-channel weights of BS.1770-5 Annex 1, Table 3.
 *
 * **`G` multiplies the mean square, not the amplitude.** It is an energy weight.
 * `10·log10(1.41)` is +1.49 dB, which is the "~ +1.5 dB" the table prints beside
 * it. Mistaking 1.41 for √2 and applying it to amplitude gives +3 dB and misses
 * the 5.0 test vector by about 1.5 LU.
 *
 * Channel order is assumed to be the WAVE order — L, R, C, LFE, Ls, Rs — because
 * an `AudioBuffer` carries no channel labels. Mono and stereo are unambiguous.
 * Anything with a channel count this does not recognise gets weights of 1, which
 * is the only honest default.
 */
export function channelWeights(numberOfChannels: number): number[] {
  if (numberOfChannels === 5) return [1, 1, 1, 1.41, 1.41];
  // The LFE channel is excluded from the measurement entirely.
  if (numberOfChannels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  return new Array(numberOfChannels).fill(1);
}

/**
 * Runs one biquad over a signal, in place, from rest.
 *
 * `Float64Array` deliberately. Two second-order sections in series at 44.1 kHz
 * accumulate error quickly in single precision, and the high pass sits at 38 Hz
 * where its poles are very close to the unit circle.
 */
function filterInPlace(samples: Float64Array, filter: Biquad): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 =
      filter.b0 * x0 +
      filter.b1 * x1 +
      filter.b2 * x2 -
      filter.a1 * y1 -
      filter.a2 * y2;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;

    samples[i] = y0;
  }
}

/**
 * A channel, K-weighted, in double precision. The input is not modified.
 *
 * **`integratedLoudness` does not call this**, and must not. It materialises the
 * whole weighted signal: a 45-minute stereo track at 44.1 kHz is 119 million
 * frames per channel, which is 952 MB of `Float64Array` per channel and 1.9 GB
 * for the pair. That is over the app's whole memory ceiling to measure one
 * number. The measurement streams instead.
 *
 * Kept because it is the honest expression of "K-weight this signal", and short
 * signals — every test in this repo — can afford it.
 */
export function kWeight(
  samples: Float32Array,
  sampleRate: number
): Float64Array {
  const out = Float64Array.from(samples);
  filterInPlace(out, kWeightingShelf(sampleRate));
  filterInPlace(out, kWeightingHighPass(sampleRate));
  return out;
}

/**
 * The sum of squares of one K-weighted channel, per 100 ms sub-block.
 *
 * This is the streaming half of the measurement. It runs both biquads sample by
 * sample and keeps **one accumulator**, never the weighted signal. Memory is one
 * float per 100 ms of audio — 27000 floats for a 45-minute track.
 *
 * Sub-blocks rather than blocks because the blocks overlap by 75%, so a 400 ms
 * gating block is exactly four consecutive 100 ms sub-blocks. Accumulating four
 * overlapping blocks directly would do the same arithmetic four times.
 */
function subBlockEnergy(
  samples: Float32Array,
  sampleRate: number,
  hop: number
): Float64Array {
  const shelf = kWeightingShelf(sampleRate);
  const highPass = kWeightingHighPass(sampleRate);

  const subBlockCount = Math.floor(samples.length / hop);
  const energy = new Float64Array(subBlockCount);

  let sx1 = 0;
  let sx2 = 0;
  let sy1 = 0;
  let sy2 = 0;
  let hx1 = 0;
  let hx2 = 0;
  let hy1 = 0;
  let hy2 = 0;

  let sum = 0;
  let subBlock = 0;
  let inSubBlock = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];

    const s0 =
      shelf.b0 * x0 +
      shelf.b1 * sx1 +
      shelf.b2 * sx2 -
      shelf.a1 * sy1 -
      shelf.a2 * sy2;
    sx2 = sx1;
    sx1 = x0;
    sy2 = sy1;
    sy1 = s0;

    const y0 =
      highPass.b0 * s0 +
      highPass.b1 * hx1 +
      highPass.b2 * hx2 -
      highPass.a1 * hy1 -
      highPass.a2 * hy2;
    hx2 = hx1;
    hx1 = s0;
    hy2 = hy1;
    hy1 = y0;

    sum += y0 * y0;

    if (++inSubBlock === hop) {
      if (subBlock < subBlockCount) energy[subBlock] = sum;
      subBlock++;
      inSubBlock = 0;
      sum = 0;
    }
  }

  return energy;
}

/**
 * Integrated loudness, in LUFS.
 *
 * Returns `-Infinity` for silence, for audio shorter than one 400 ms block, and
 * for audio where every block falls below the gate. A caller that turns this
 * into a gain must handle that — `loudnessGain` does.
 *
 * The three details the specification states and that are easy to get wrong,
 * all of which the research called out:
 *
 * 1. The gate comparison is **strictly greater than**. The example code in EBU
 *    Tech 3342 uses `>=` and FFmpeg flags the conflict in a comment. The
 *    specification says `>`, and on a synthetic signal sitting exactly on the
 *    threshold the two disagree.
 * 2. **An incomplete trailing block is discarded.** "The measurement interval
 *    shall be constrained such that it ends at the end of a gating block."
 * 3. The mean is taken over the **mean squares**, in the energy domain, never
 *    over the block loudnesses in dB. Averaging decibels is a classic bug.
 */
export function integratedLoudness(
  channels: Float32Array[],
  sampleRate: number
): number {
  if (channels.length === 0) return -Infinity;

  const blockSize = Math.round(BLOCK_SECONDS * sampleRate);
  const hop = Math.round(blockSize * (1 - OVERLAP));
  const length = channels[0].length;
  if (blockSize <= 0 || hop <= 0 || length < blockSize) return -Infinity;

  // A block is four hops, because the overlap is 75%.
  const hopsPerBlock = Math.round(blockSize / hop);
  const weights = channelWeights(channels.length);

  const energy = channels.map((channel, index) =>
    weights[index] === 0
      ? null
      : subBlockEnergy(channel, sampleRate, hop)
  );

  const subBlockCount = Math.floor(length / hop);
  const blockCount = subBlockCount - hopsPerBlock + 1;
  if (blockCount <= 0) return -Infinity;

  /** The weighted sum of mean squares for each block: `Σ G_i · z_ij`. */
  const blockPower = new Float64Array(blockCount);

  for (let block = 0; block < blockCount; block++) {
    let sum = 0;

    for (let channel = 0; channel < energy.length; channel++) {
      const samples = energy[channel];
      if (!samples) continue;

      let square = 0;
      for (let hopIndex = 0; hopIndex < hopsPerBlock; hopIndex++) {
        square += samples[block + hopIndex];
      }
      sum += (weights[channel] * square) / blockSize;
    }

    blockPower[block] = sum;
  }

  const loudnessOf = (power: number) =>
    power > 0 ? OFFSET_DB + 10 * Math.log10(power) : -Infinity;

  // Pass one: the absolute gate.
  const abovePower: number[] = [];
  for (let block = 0; block < blockCount; block++) {
    if (loudnessOf(blockPower[block]) > ABSOLUTE_GATE_LUFS) {
      abovePower.push(blockPower[block]);
    }
  }
  if (abovePower.length === 0) return -Infinity;

  // Pass two: the relative gate, ten LU below what pass one measured.
  const relativeGate =
    loudnessOf(mean(abovePower)) + RELATIVE_GATE_LU;

  const gatedPower: number[] = [];
  for (let block = 0; block < blockCount; block++) {
    const loudness = loudnessOf(blockPower[block]);
    if (loudness > ABSOLUTE_GATE_LUFS && loudness > relativeGate) {
      gatedPower.push(blockPower[block]);
    }
  }
  if (gatedPower.length === 0) return -Infinity;

  return loudnessOf(mean(gatedPower));
}

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * ITU-R BS.1770-5 Annex 2's order-48, 4-phase interpolating FIR.
 *
 * Rows are tap index, columns are phase. The specification offers it as "one set
 * of filter coefficients … that would satisfy the requirements", not as the only
 * one, and clause 5 allows "a method that gives similar or superior results".
 *
 * Two structural checks confirm the transcription: the taps sum to 3.949, which
 * is the interpolation factor of 4 less the filter's −0.11 dB at DC, and every
 * coefficient is an exact multiple of 2⁻¹⁶. It is a 16-bit fixed-point filter by
 * design, which is why the specification's step 1 attenuates by 12.04 dB.
 */
const TRUE_PEAK_FIR: readonly (readonly number[])[] = [
  [0.001708984375, -0.0291748046875, -0.0189208984375, -0.00830078125],
  [0.010986328125, 0.029296875, 0.0330810546875, 0.0148925781250],
  [-0.0196533203125, -0.05175781250, -0.0582275390625, -0.026611328125],
  [0.033203125, 0.089111328125, 0.1015625, 0.047607421875],
  [-0.0594482421875, -0.16650390625, -0.2003173828125, -0.1022949218750],
  [0.1373291015625, 0.465087890625, 0.77978515625, 0.97216796875],
  [0.97216796875, 0.77978515625, 0.465087890625, 0.1373291015625],
  [-0.1022949218750, -0.2003173828125, -0.16650390625, -0.0594482421875],
  [0.047607421875, 0.1015625, 0.089111328125, 0.033203125],
  [-0.026611328125, -0.0582275390625, -0.05175781250, -0.0196533203125],
  [0.0148925781250, 0.0330810546875, 0.029296875, 0.010986328125],
  [-0.00830078125, -0.0189208984375, -0.0291748046875, 0.001708984375],
];

/**
 * How much to oversample by, to reach at least the 192 kHz the specification
 * asks for.
 *
 * "Incoming signals that are at higher sampling rates require proportionately
 * less over-sampling." `libebur128` implements the same switch.
 */
function oversamplingFor(sampleRate: number): number {
  if (sampleRate >= 192000) return 1;
  if (sampleRate >= 96000) return 2;
  return 4;
}

/**
 * True peak, in dBTP. Returns `-Infinity` for silence.
 *
 * **The 12.04 dB attenuate-and-restore pair is deliberately skipped.** The
 * specification says so itself: "This step is not necessary if the calculations
 * are performed in floating point." It exists to give integer arithmetic
 * headroom, and in floating point it only costs precision.
 *
 * A true peak is not a sample peak. A signal whose samples all sit below full
 * scale can still reconstruct above it between them, which is exactly what a
 * digital-to-analog converter and a lossy encoder both do.
 */
export function truePeakDb(
  channels: Float32Array[],
  sampleRate: number
): number {
  let peak = 0;
  const factor = oversamplingFor(sampleRate);

  for (const samples of channels) {
    peak = Math.max(peak, channelTruePeak(samples, factor));
  }

  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * The most any interpolated output can exceed the largest input in its window.
 *
 * It is the largest per-phase sum of absolute taps, about 1.434, or +3.13 dB.
 * Computed rather than written down, so editing the table cannot leave a stale
 * constant behind that would let a clip through.
 */
const MAX_PHASE_GAIN = (() => {
  let worst = 0;
  for (let phase = 0; phase < 4; phase++) {
    let sum = 0;
    for (const row of TRUE_PEAK_FIR) sum += Math.abs(row[phase]);
    if (sum > worst) worst = sum;
  }
  return worst;
})();

function samplePeakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/**
 * The true peak of one channel.
 *
 * ## Why this does not simply filter everything
 *
 * Interpolating every sample costs twelve taps times four phases, which is 48
 * multiply-adds per input sample. A 45-minute stereo track is 238 million
 * samples, so filtering all of it is over eleven billion operations — about
 * eleven seconds, in a worker, to learn one number.
 *
 * It is also almost entirely wasted. An interpolated output cannot exceed the
 * largest input in its twelve-sample window by more than `MAX_PHASE_GAIN`, which
 * is +3.13 dB. So any window whose samples all sit more than 3.13 dB below the
 * sample peak **cannot** contain the true peak, and there is no reason to filter
 * it.
 *
 * Two cheap passes mark the windows that could matter, and only those are
 * filtered. On real music the peaks are rare and this is a rounding error. On a
 * brickwalled master where most samples sit at the ceiling it degrades to
 * filtering everything, which is the honest worst case and still correct.
 *
 * **The result is exact, not an estimate.** The bound only decides what to skip,
 * and it only skips what provably cannot win.
 */
function channelTruePeak(samples: Float32Array, factor: number): number {
  const samplePeak = samplePeakOf(samples);

  // At 192 kHz or above there is nothing to interpolate: the sample peak is the
  // true peak, to the accuracy the specification asks for.
  if (factor === 1 || samplePeak === 0) return samplePeak;

  const taps = TRUE_PEAK_FIR.length;
  const step = 4 / factor; // four phases available; use all, or every other
  const threshold = samplePeak / MAX_PHASE_GAIN;

  // Mark every output position whose window holds a sample big enough to
  // matter. An output at `n` reads inputs `n − 11` through `n`, so one large
  // sample at `i` puts `i` through `i + 11` in play.
  const wanted = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) < threshold) continue;
    const last = Math.min(i + taps, samples.length);
    for (let n = i; n < last; n++) wanted[n] = 1;
  }

  // The true peak is never below the sample peak, so start there.
  let peak = samplePeak;

  for (let n = 0; n < samples.length; n++) {
    if (!wanted[n]) continue;

    for (let phase = 0; phase < 4; phase += step) {
      let sum = 0;
      for (let k = 0; k < taps; k++) {
        const index = n - k;
        if (index < 0) break;
        sum += TRUE_PEAK_FIR[k][phase] * samples[index];
      }
      const magnitude = Math.abs(sum);
      if (magnitude > peak) peak = magnitude;
    }
  }

  return peak;
}

/**
 * The gain that takes audio at `measuredLufs` to `targetLufs`, **capped so the
 * true peak cannot pass `ceilingDbTp`**.
 *
 * The cap is the whole reason this is not one line of arithmetic. Lifting a
 * quiet recording to −14 LUFS can push its peaks well past full scale, and a
 * sample-peak limiter does not catch what happens between samples.
 *
 * **A capped gain does not reach the target, and that is correct.** Every
 * loudness normalizer behaves this way; it is why streaming services turn loud
 * masters down rather than turning quiet ones up without limit. The alternative
 * is a true-peak limiter, which changes the sound rather than the level.
 *
 * Silence, or audio with no measurable loudness, returns 1. It cannot be made
 * louder and it must not become `NaN`.
 */
export function loudnessGain(
  measuredLufs: number,
  targetLufs: number,
  measuredTruePeakDb: number,
  ceilingDbTp: number
): number {
  if (!Number.isFinite(measuredLufs)) return 1;

  const wanted = Math.pow(10, (targetLufs - measuredLufs) / 20);
  if (!Number.isFinite(measuredTruePeakDb)) return wanted;

  const allowed = Math.pow(10, (ceilingDbTp - measuredTruePeakDb) / 20);
  return Math.min(wanted, allowed);
}
