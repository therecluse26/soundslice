import { describe, expect, it } from "vitest";
import {
  dbToGain,
  fadeTimes,
  gainToDb,
  maxAmplitude,
  peakNormalizationGain,
  regionFrameCount,
  rmsDbWindows,
} from "./dsp";

/**
 * The first test in this repo. Its job is to prove the runner works, and to fix
 * the pattern every later DSP test follows: plain arrays in, one number out, no
 * Web Audio anywhere.
 *
 * `vitest` is imported explicitly rather than taken from globals, so `tsc`
 * type-checks this file during `pnpm build` without a `types` entry.
 */
describe("maxAmplitude", () => {
  it("returns 0 for no channels", () => {
    expect(maxAmplitude([])).toBe(0);
  });

  it("returns 0 for silence", () => {
    expect(maxAmplitude([new Float32Array(128)])).toBe(0);
  });

  it("finds the peak in one channel", () => {
    expect(maxAmplitude([new Float32Array([0.1, 0.7, 0.3])])).toBeCloseTo(0.7);
  });

  it("counts a negative peak, because amplitude is absolute", () => {
    expect(maxAmplitude([new Float32Array([0.2, -0.9, 0.4])])).toBeCloseTo(0.9);
  });

  it("takes the loudest channel, not the first", () => {
    const left = new Float32Array([0.2, 0.3]);
    const right = new Float32Array([0.2, 0.95]);
    expect(maxAmplitude([left, right])).toBeCloseTo(0.95);
  });

  it("does not clamp above full scale", () => {
    // Decoded audio can exceed 1.0. Clamping here would hide clipping from the
    // limiter, which is the thing that is supposed to catch it.
    expect(maxAmplitude([new Float32Array([1.4])])).toBeCloseTo(1.4);
  });
});

describe("dbToGain and gainToDb", () => {
  it("makes 0 dB unity", () => {
    expect(dbToGain(0)).toBe(1);
  });

  it("makes −6 dB roughly half", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 4);
  });

  it("round-trips", () => {
    expect(gainToDb(dbToGain(-0.95))).toBeCloseTo(-0.95, 10);
  });

  it("reports silence as minus infinity, not NaN", () => {
    expect(gainToDb(0)).toBe(-Infinity);
  });
});

describe("peakNormalizationGain", () => {
  it("is 1 over the peak at a target of 0 dBFS", () => {
    // This is the number `normalize` in `audio-processors.ts` computed, and it
    // is what "Normalize Levels? Yes" must keep doing.
    expect(peakNormalizationGain(0.5, 0)).toBeCloseTo(2);
  });

  it("leaves silence alone instead of dividing by zero", () => {
    // A silent region used to give Infinity, and Infinity times any sample is
    // NaN. The whole buffer came out as NaN.
    expect(peakNormalizationGain(0, 0)).toBe(1);
  });

  it("turns a hot region down to reach a target below full scale", () => {
    expect(peakNormalizationGain(1, -6)).toBeCloseTo(0.5012, 4);
  });
});

describe("fadeTimes", () => {
  it("puts the 20 ms default fades at each edge", () => {
    expect(fadeTimes(10, 20, 20)).toEqual({ fadeInEnd: 0.02, fadeOutStart: 9.98 });
  });

  it("shortens both fades together when they will not fit", () => {
    // 20 ms plus 20 ms in a 30 ms region. The old per-sample loop multiplied
    // the same samples by both factors and dipped in the middle.
    const { fadeInEnd, fadeOutStart } = fadeTimes(0.03, 20, 20);
    expect(fadeInEnd).toBeCloseTo(0.015, 6);
    expect(fadeOutStart).toBeCloseTo(0.015, 6);
  });

  it("allows no fade at all", () => {
    expect(fadeTimes(10, 0, 0)).toEqual({ fadeInEnd: 0, fadeOutStart: 10 });
  });

  it("reports both edges at zero for an empty region", () => {
    expect(fadeTimes(0, 20, 20)).toEqual({ fadeInEnd: 0, fadeOutStart: 0 });
  });
});

describe("regionFrameCount", () => {
  it("rounds rather than truncating", () => {
    // 0.5 s at 44100 is 22050 frames exactly; 0.50001 s is 22050.44, which the
    // old `createBuffer(duration * sampleRate)` truncated.
    expect(regionFrameCount(0, 0.50001, 44100)).toBe(22050);
    expect(regionFrameCount(0, 0.500015, 44100)).toBe(22051);
  });

  it("never returns zero, because OfflineAudioContext rejects it", () => {
    expect(regionFrameCount(5, 5, 44100)).toBe(1);
  });
});

describe("rmsDbWindows", () => {
  /** `size` samples alternating between +amplitude and −amplitude. */
  const steady = (amplitude: number, size: number) =>
    Float32Array.from({ length: size }, (_, i) =>
      i % 2 === 0 ? amplitude : -amplitude
    );

  it("reads full scale as 0 dBFS", () => {
    expect(rmsDbWindows([steady(1, 8)], 8)[0]).toBeCloseTo(0, 6);
  });

  it("reads half amplitude as about −6 dBFS", () => {
    expect(rmsDbWindows([steady(0.5, 8)], 8)[0]).toBeCloseTo(-6.0206, 3);
  });

  it("reads silence as −Infinity, not 0", () => {
    // A comparison against a threshold is then correct with no special case.
    // `NaN` would silently be false on both sides of every comparison.
    expect(rmsDbWindows([new Float32Array(8)], 8)[0]).toBe(-Infinity);
  });

  it("gives one number per window", () => {
    expect(rmsDbWindows([steady(1, 40)], 8)).toHaveLength(5);
  });

  it("keeps a short last window rather than dropping it", () => {
    // Dropping it would lose up to one window of audio at the end of every
    // file, which for split on silence means losing the last phrase.
    expect(rmsDbWindows([steady(1, 20)], 8)).toHaveLength(3);
  });

  it("averages across every channel", () => {
    // One channel at full scale and one silent is half the energy, so 3 dB
    // below full scale — not 0 dBFS, and not −Infinity.
    const both = rmsDbWindows([steady(1, 8), new Float32Array(8)], 8)[0];
    expect(both).toBeCloseTo(-3.0103, 3);
  });

  it("answers for no channels and for no samples", () => {
    expect(rmsDbWindows([], 8)).toHaveLength(0);
    expect(rmsDbWindows([new Float32Array(0)], 8)).toHaveLength(0);
  });

  it("never divides by a window of zero samples", () => {
    expect(rmsDbWindows([steady(1, 4)], 0)).toHaveLength(4);
  });

  it("reads a subarray, so a chunked scan costs no memory", () => {
    // `region-tools.ts` slices the channels with `subarray` and calls this per
    // chunk. A copy per chunk would double peak memory on a 45-minute track.
    const whole = steady(1, 32);
    const half = whole.subarray(16, 32);

    expect(Array.from(rmsDbWindows([half], 8))).toEqual(
      Array.from(rmsDbWindows([whole], 8)).slice(2)
    );
  });
});
