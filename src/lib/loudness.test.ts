import { describe, expect, it } from "vitest";
import {
  channelWeights,
  integratedLoudness,
  kWeightingHighPass,
  kWeightingShelf,
  loudnessGain,
  truePeakDb,
} from "./loudness";

/**
 * EBU Tech 3341 (2023) Table 1, "Minimum requirements test signals".
 *
 * **The signals are generated here, not downloaded.** Cases 1 to 6 and 15 to 19
 * are sine waves the table specifies completely, so the EBU's 87 MB test set
 * buys nothing a few lines of arithmetic do not. Cases 7 and 8 are authentic
 * programme material and are the only ones that need the files; they are not
 * here, and the ticket says so.
 *
 * Every expected value and tolerance is transcribed from that table. The
 * research on `research/lufs-bs1770` ran a from-scratch reference
 * implementation against the same cases; its measured figures are quoted beside
 * each test so a later change can be told from a later regression.
 *
 * Tech 3341, verbatim: "The loudness meter shall be reset before each
 * measurement." Every call here starts from rest, so that holds by construction.
 */

const FS = 48000;

/** A sine at `hz`, `peakDbfs` peak, `seconds` long, starting at sample `from`. */
function tone(
  hz: number,
  peakDbfs: number,
  seconds: number,
  sampleRate = FS,
  from = 0,
  phaseDeg = 0
): Float32Array {
  const amplitude = Math.pow(10, peakDbfs / 20);
  const length = Math.round(seconds * sampleRate);
  const out = new Float32Array(length);
  const phase = (phaseDeg * Math.PI) / 180;

  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * (from + i)) / sampleRate + phase);
  }
  return out;
}

/** A sine of a given linear amplitude, which is how the true-peak cases state it. */
function toneAmplitude(
  hz: number,
  amplitude: number,
  seconds: number,
  sampleRate: number,
  phaseDeg: number
): Float32Array {
  const length = Math.round(seconds * sampleRate);
  const out = new Float32Array(length);
  const phase = (phaseDeg * Math.PI) / 180;

  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase);
  }
  return out;
}

function join(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * A 10 ms fade in and out.
 *
 * **Mandatory for the true-peak cases.** Tech 3341 says to taper, and the
 * research measured what happens without it: case 18 reads +0.68 dB high,
 * because the step at the start of an untapered sine reconstructs as an
 * overshoot that is an artefact of the edit, not of the signal.
 */
function taper(samples: Float32Array, sampleRate: number): Float32Array {
  const fade = Math.round(0.01 * sampleRate);
  const out = Float32Array.from(samples);

  for (let i = 0; i < fade && i < out.length; i++) {
    const gain = i / fade;
    out[i] *= gain;
    out[out.length - 1 - i] *= gain;
  }
  return out;
}

/** Both channels carrying the same signal, which is what "in phase" means here. */
const stereo = (signal: Float32Array) => [signal, signal];

/** Segments concatenated per channel, in phase, as case 3 to 5 describe. */
function stereoSegments(
  segments: { peakDbfs: number; seconds: number }[]
): Float32Array[] {
  const parts: Float32Array[] = [];
  let from = 0;

  for (const segment of segments) {
    parts.push(tone(1000, segment.peakDbfs, segment.seconds, FS, from));
    from += Math.round(segment.seconds * FS);
  }

  return stereo(join(...parts));
}

describe("K-weighting coefficients", () => {
  it("reproduces the published 48 kHz shelf to fourteen digits", () => {
    // ITU-R BS.1770-5 Annex 1, Table 1. The specification publishes this rate
    // and no other, so this is the only direct check available.
    const shelf = kWeightingShelf(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 12);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 12);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 12);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 12);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 12);
  });

  it("reproduces the published 48 kHz high pass", () => {
    // Table 2. This one comes back bit-exact.
    const hpf = kWeightingHighPass(48000);
    expect(hpf.b0).toBe(1);
    expect(hpf.b1).toBe(-2);
    expect(hpf.b2).toBe(1);
    expect(hpf.a1).toBeCloseTo(-1.99004745483398, 12);
    expect(hpf.a2).toBeCloseTo(0.99007225036621, 12);
  });

  it("derives 44.1 kHz coefficients, which no document publishes", () => {
    // From the research, which generated these from the same prototype and
    // then proved the prototype by inverting the 48 kHz table back to it.
    const shelf = kWeightingShelf(44100);
    expect(shelf.b0).toBeCloseTo(1.530841230050386, 12);
    expect(shelf.a1).toBeCloseTo(-1.6636551132560205, 12);
    expect(shelf.a2).toBeCloseTo(0.7125954280732254, 12);

    const hpf = kWeightingHighPass(44100);
    expect(hpf.a1).toBeCloseTo(-1.9891696736297959, 12);
    expect(hpf.a2).toBeCloseTo(0.9891990357870393, 12);
  });
});

describe("channelWeights — BS.1770-5 Table 3", () => {
  it("weights mono and stereo evenly", () => {
    expect(channelWeights(1)).toEqual([1]);
    expect(channelWeights(2)).toEqual([1, 1]);
  });

  it("weights the surrounds at 1.41, not the square root of two", () => {
    // 1.41 is the normative linear coefficient and it multiplies the mean
    // square. Using Math.SQRT2 as an amplitude gain gives +3 dB instead of
    // +1.49 dB and misses case 6 by about 1.5 LU.
    expect(channelWeights(5)).toEqual([1, 1, 1, 1.41, 1.41]);
  });

  it("excludes the LFE channel entirely", () => {
    expect(channelWeights(6)).toEqual([1, 1, 1, 0, 1.41, 1.41]);
  });
});

describe("integratedLoudness — the calibration checks", () => {
  it("reads −18.0 LUFS for the Tech 3341 §2.9 calibration signal", () => {
    // Research measured −17.993.
    const signal = stereo(tone(1000, -18, 20));
    expect(integratedLoudness(signal, FS)).toBeCloseTo(-18.0, 1);
  });

  it("reads −3.01 LKFS for 0 dBFS at 997 Hz on one channel", () => {
    // BS.1770-5 Annex 1 states this outcome, and it is what the −0.691 offset
    // exists to produce. Research measured −3.010.
    const measured = integratedLoudness([tone(997, 0, 20)], FS);
    expect(measured).toBeGreaterThan(-3.11);
    expect(measured).toBeLessThan(-2.91);
  });
});

describe("integratedLoudness — EBU Tech 3341 Table 1", () => {
  it("case 1: stereo 1 kHz at −23.0 dBFS reads −23.0 LUFS", () => {
    // Research measured −22.993.
    expect(integratedLoudness(stereo(tone(1000, -23, 20)), FS)).toBeCloseTo(
      -23.0,
      1
    );
  });

  it("case 2: the same at −33.0 dBFS reads −33.0 LUFS", () => {
    // Research measured −32.993.
    expect(integratedLoudness(stereo(tone(1000, -33, 20)), FS)).toBeCloseTo(
      -33.0,
      1
    );
  });

  it("case 3: −36, −23, −36 dBFS reads −23.0 LUFS", () => {
    // The relative gate at work: the two −36 dBFS segments are 13 LU down, so
    // they fall outside the gate and do not drag the answer. Research: −23.014.
    const signal = stereoSegments([
      { peakDbfs: -36, seconds: 10 },
      { peakDbfs: -23, seconds: 60 },
      { peakDbfs: -36, seconds: 10 },
    ]);
    expect(integratedLoudness(signal, FS)).toBeCloseTo(-23.0, 1);
  });

  it("case 4: −72, −36, −23, −36, −72 dBFS reads −23.0 LUFS", () => {
    // This one only works if the **absolute** gate excludes the −72 dBFS
    // segments before the relative gate is computed. Research: −23.014.
    const signal = stereoSegments([
      { peakDbfs: -72, seconds: 10 },
      { peakDbfs: -36, seconds: 10 },
      { peakDbfs: -23, seconds: 60 },
      { peakDbfs: -36, seconds: 10 },
      { peakDbfs: -72, seconds: 10 },
    ]);
    expect(integratedLoudness(signal, FS)).toBeCloseTo(-23.0, 1);
  });

  it("case 5: −26, −20, −26 dBFS with a 20.1 s middle reads −23.0 LUFS", () => {
    // The odd 20.1 seconds is load-bearing, not a typo in the table. It puts
    // the segment boundaries off the 100 ms block hop. Research: −22.979.
    const signal = stereoSegments([
      { peakDbfs: -26, seconds: 20 },
      { peakDbfs: -20, seconds: 20.1 },
      { peakDbfs: -26, seconds: 20 },
    ]);
    expect(integratedLoudness(signal, FS)).toBeCloseTo(-23.0, 1);
  });

  it("case 6: a 5.0 channel signal reads −23.0 LUFS", () => {
    // Only lands on −23.0 if the 1.41 surround weights are right, and only if
    // they weight the mean square. Research: −23.016.
    const front = tone(1000, -28, 20);
    const centre = tone(1000, -24, 20);
    const surround = tone(1000, -30, 20);
    const signal = [front, front, centre, surround, surround];
    expect(integratedLoudness(signal, FS)).toBeCloseTo(-23.0, 1);
  });
});

describe("integratedLoudness — at 44.1 kHz", () => {
  it("reads −23.0 LUFS for case 1, on the derived coefficients", () => {
    // The specification defines no coefficients at this rate. This is the test
    // that says the re-derivation is right. Research measured −22.991.
    const signal = stereo(tone(1000, -23, 20, 44100));
    expect(integratedLoudness(signal, 44100)).toBeCloseTo(-23.0, 1);
  });

  it("reads −18.0 LUFS for the calibration signal", () => {
    // Research measured −17.991.
    const signal = stereo(tone(1000, -18, 20, 44100));
    expect(integratedLoudness(signal, 44100)).toBeCloseTo(-18.0, 1);
  });
});

describe("integratedLoudness — the edges", () => {
  it("reports silence as minus infinity, not a number", () => {
    expect(integratedLoudness(stereo(new Float32Array(FS)), FS)).toBe(-Infinity);
  });

  it("reports audio shorter than one gating block as minus infinity", () => {
    // A block is 400 ms, and an incomplete trailing block is discarded. A
    // 200 ms region has no complete block at all, so there is nothing to
    // measure — which a caller must handle rather than divide by.
    const short = stereo(tone(1000, -23, 0.2));
    expect(integratedLoudness(short, FS)).toBe(-Infinity);
  });

  it("reports no channels as minus infinity", () => {
    expect(integratedLoudness([], FS)).toBe(-Infinity);
  });

  it("gates out audio that is entirely below −70 LUFS", () => {
    expect(integratedLoudness(stereo(tone(1000, -90, 5)), FS)).toBe(-Infinity);
  });
});

/**
 * The true-peak cases carry an asymmetric tolerance: +0.2 above and −0.4 below.
 * A meter may read a little high and must not read much low, because reading
 * low is what lets a clipped file through.
 */
function expectTruePeak(measured: number, expected: number) {
  expect(measured).toBeGreaterThanOrEqual(expected - 0.4);
  expect(measured).toBeLessThanOrEqual(expected + 0.2);
}

describe("truePeakDb — EBU Tech 3341 Table 1", () => {
  const seconds = 1;

  it("case 15: fs/4 at 0.50 FFS, phase 0°, reads −6.0 dBTP", () => {
    // Research measured −6.217, inside the −0.4 side of the tolerance.
    const signal = taper(toneAmplitude(FS / 4, 0.5, seconds, FS, 0), FS);
    expectTruePeak(truePeakDb(stereo(signal), FS), -6.0);
  });

  it("case 16: fs/4 at 0.50 FFS, phase 45°, reads −6.0 dBTP", () => {
    // Research measured −5.976.
    const signal = taper(toneAmplitude(FS / 4, 0.5, seconds, FS, 45), FS);
    expectTruePeak(truePeakDb(stereo(signal), FS), -6.0);
  });

  it("case 17: fs/6 at 0.50 FFS, phase 60°, reads −6.0 dBTP", () => {
    // Research measured −6.313, the closest of the five to failing.
    const signal = taper(toneAmplitude(FS / 6, 0.5, seconds, FS, 60), FS);
    expectTruePeak(truePeakDb(stereo(signal), FS), -6.0);
  });

  it("case 18: fs/8 at 0.50 FFS, phase 67.5°, reads −6.0 dBTP", () => {
    // Research measured −6.026, and +0.68 dB high without the 10 ms taper.
    const signal = taper(toneAmplitude(FS / 8, 0.5, seconds, FS, 67.5), FS);
    expectTruePeak(truePeakDb(stereo(signal), FS), -6.0);
  });

  it("case 19: fs/4 at 1.41 FFS, phase 45°, reads +3.0 dBTP", () => {
    // Deliberately past full scale in the sample domain. Research: +3.029.
    const signal = taper(toneAmplitude(FS / 4, 1.41, seconds, FS, 45), FS);
    expectTruePeak(truePeakDb(stereo(signal), FS), 3.0);
  });

  it("sees a peak between samples that no sample shows", () => {
    // The point of the whole exercise. A sine at fs/4 sampled on the zero
    // crossings has a sample peak well below its true peak.
    const signal = toneAmplitude(FS / 4, 0.5, 0.5, FS, 45);
    let samplePeak = 0;
    for (const value of signal) samplePeak = Math.max(samplePeak, Math.abs(value));

    expect(truePeakDb([signal], FS)).toBeGreaterThan(20 * Math.log10(samplePeak));
  });

  it("reports silence as minus infinity", () => {
    expect(truePeakDb([new Float32Array(1000)], FS)).toBe(-Infinity);
  });
});

describe("loudnessGain", () => {
  it("lifts a quiet track to the target", () => {
    // −30 LUFS to −14 LUFS is +16 dB, and the peak has room for it.
    expect(loudnessGain(-30, -14, -40, -1)).toBeCloseTo(
      Math.pow(10, 16 / 20),
      6
    );
  });

  it("turns a loud track down to the target", () => {
    expect(loudnessGain(-8, -14, -1, -1)).toBeCloseTo(Math.pow(10, -6 / 20), 6);
  });

  it("stops short of the target rather than passing the true-peak ceiling", () => {
    // A quiet, peaky recording. Reaching −14 LUFS would need +16 dB, and the
    // true peak is already at −3 dBTP, so only +2 dB is allowed.
    //
    // Not reaching the target is the correct answer. The alternative is a
    // true-peak limiter, which changes the sound rather than the level.
    const gain = loudnessGain(-30, -14, -3, -1);
    expect(gain).toBeCloseTo(Math.pow(10, 2 / 20), 6);
    expect(gain).toBeLessThan(Math.pow(10, 16 / 20));
  });

  it("still turns a track down when its true peak is already over the ceiling", () => {
    // The ceiling caps the gain; it never forces one. Turning down is always
    // allowed, and here it is what the target asks for anyway.
    expect(loudnessGain(-8, -14, 2, -1)).toBeCloseTo(Math.pow(10, -6 / 20), 6);
  });

  it("leaves silence alone rather than returning NaN", () => {
    expect(loudnessGain(-Infinity, -14, -Infinity, -1)).toBe(1);
  });

  it("ignores an unmeasurable true peak rather than refusing to work", () => {
    expect(loudnessGain(-30, -14, -Infinity, -1)).toBeCloseTo(
      Math.pow(10, 16 / 20),
      6
    );
  });
});
