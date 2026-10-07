import { describe, expect, it } from "vitest";
import { SPECTRAL_FFT_SIZE, spectralKit } from "./spectral";

const kit = spectralKit();
const RATE = 48000;

function sine(hz: number, seconds: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return out;
}

/** A repeatable white noise, so a test cannot pass by luck. */
function noise(seconds: number, amplitude: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let state = seed;
  for (let i = 0; i < out.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = amplitude * ((state / 2 ** 32) * 2 - 1);
  }
  return out;
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** The strongest frequency in a signal, by zero crossings. Good enough for a sine. */
function pitchOf(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  }
  return (crossings * RATE) / samples.length;
}

describe("fft", () => {
  it("gives the input back through forward and inverse", () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i / 64);
    const im = new Float64Array(64);
    const original = re.slice();

    kit.fft(re, im, false);
    kit.fft(re, im, true);

    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(original[i], 10);
  });
});

describe("the denoiser", () => {
  it("is the input, to the sample, at amount 0", () => {
    const input = sine(440, 0.5);
    const profile = kit.noiseSpectrum([noise(0.5, 0.05)], SPECTRAL_FFT_SIZE);
    const out = kit.runOffline(
      kit.createDenoiser(SPECTRAL_FFT_SIZE, profile, 0),
      input
    );

    expect(out.length).toBe(input.length);
    // Away from the two edges, where the first and last frames are partial.
    for (let i = 4096; i < input.length - 4096; i += 97) {
      expect(out[i]).toBeCloseTo(input[i], 4);
    }
  });

  it("turns noise down and leaves a tone mostly alone", () => {
    const hiss = noise(1, 0.05, 7);
    const profile = kit.noiseSpectrum([noise(1, 0.05, 3)], SPECTRAL_FFT_SIZE);

    const quiet = kit.runOffline(
      kit.createDenoiser(SPECTRAL_FFT_SIZE, profile, 1),
      hiss
    );
    // At least 12 dB down on noise alone.
    expect(rms(quiet, 4096, quiet.length - 4096)).toBeLessThan(
      rms(hiss, 4096, hiss.length - 4096) / 4
    );

    const tone = sine(1000, 1, 0.5);
    const mixed = tone.map((value, i) => value + hiss[i]);
    const cleaned = kit.runOffline(
      kit.createDenoiser(SPECTRAL_FFT_SIZE, profile, 1),
      mixed
    );
    // The tone keeps its level within 1 dB.
    const ratio = rms(cleaned, 4096, 40000) / rms(tone, 4096, 40000);
    expect(ratio).toBeGreaterThan(0.89);
    expect(ratio).toBeLessThan(1.12);
  });
});

describe("resampleProfile", () => {
  it("reads the same frequency at another rate", () => {
    const flat = Float32Array.from({ length: 1025 }, (_, k) => k);
    const at96 = kit.resampleProfile(flat, 48000, 96000);
    // Bin 100 at 96 kHz is 4687.5 Hz, which is bin 200 at 48 kHz.
    expect(at96[100]).toBeCloseTo(200, 5);
    expect(at96[1000]).toBe(1024);
  });
});

describe("time and pitch", () => {
  it("varispeed at twice the speed halves the length and doubles the pitch", () => {
    const out = kit.varispeed(sine(440, 1), 2);
    expect(out.length).toBe(RATE / 2);
    expect(pitchOf(out)).toBeCloseTo(880, -1);
  });

  it("a pitch shift of 0 is the input back", () => {
    const input = sine(440, 0.5);
    const out = kit.runOffline(
      kit.createPitchShifter(SPECTRAL_FFT_SIZE, 0),
      input
    );
    expect(rms(out, 4096, input.length - 4096)).toBeCloseTo(
      rms(input, 4096, input.length - 4096),
      2
    );
  });

  it("shifts a tone up an octave and keeps the length", () => {
    const input = sine(440, 1);
    const out = kit.stretchChannel(input, 1, 12, SPECTRAL_FFT_SIZE);
    expect(out.length).toBe(input.length);
    expect(pitchOf(out.subarray(4096, out.length - 4096))).toBeGreaterThan(860);
    expect(pitchOf(out.subarray(4096, out.length - 4096))).toBeLessThan(900);
  });

  it("plays twice as fast at the same pitch", () => {
    const out = kit.stretchChannel(sine(440, 1), 2, 0, SPECTRAL_FFT_SIZE);
    expect(out.length).toBe(RATE / 2);
    const pitch = pitchOf(out.subarray(4096, out.length - 4096));
    expect(pitch).toBeGreaterThan(425);
    expect(pitch).toBeLessThan(455);
  });

  it("is self-contained, so a worklet can be built from its source", () => {
    // The worklet is `(${spectralKit})()`. If the function reached for anything
    // outside itself, this would throw a ReferenceError here first.
    const rebuilt = new Function(`return (${spectralKit.toString()})();`)();
    expect(typeof rebuilt.createDenoiser).toBe("function");
  });
});

describe("latency", () => {
  it("is what each processor says it is, to the sample", () => {
    for (const processor of [
      kit.createDenoiser(SPECTRAL_FFT_SIZE, new Float32Array(1025), 0),
      kit.createPitchShifter(SPECTRAL_FFT_SIZE, 0),
    ]) {
      const input = new Float32Array(20000);
      input[5000] = 1;
      const out = new Float32Array(input.length);
      processor.process(input, out);

      let peak = 0;
      for (let i = 0; i < out.length; i++) {
        if (Math.abs(out[i]) > Math.abs(out[peak])) peak = i;
      }
      expect(peak).toBe(5000 + processor.latency);
    }
  });
});
