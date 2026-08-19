import { describe, expect, it } from "vitest";
import { maxAmplitude } from "./dsp";

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
