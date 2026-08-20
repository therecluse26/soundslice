import { describe, expect, it } from "vitest";
import {
  SNAP_RADIUS_PX,
  TRANSIENT_DEFAULTS,
  TRANSIENT_WINDOW_MS,
  detectTransients,
  nearestTransient,
  onsetsFromLevels,
  transientWindowSamples,
} from "./transients";

const RATE = 8000;

/**
 * A mono track built from a script of `[seconds, amplitude]` pairs.
 *
 * Alternating sign, so the RMS of a stretch equals its amplitude exactly and a
 * threshold in dB means what the test says it means.
 */
function track(script: Array<[number, number]>): Float32Array {
  const total = script.reduce((sum, [seconds]) => sum + seconds, 0);
  const samples = new Float32Array(Math.round(total * RATE));

  let at = 0;
  for (const [seconds, amplitude] of script) {
    const frames = Math.round(seconds * RATE);
    for (let i = 0; i < frames; i++) {
      samples[at + i] = i % 2 === 0 ? amplitude : -amplitude;
    }
    at += frames;
  }

  return samples;
}

/** How close a detected onset must be to the truth, in seconds. */
const TOLERANCE_SEC = 0.002;

describe("detectTransients", () => {
  it("lands on a hit that starts out of silence", () => {
    // Silence for a second, then a sound. The refinement inside the winning hop
    // is what makes this 2 ms rather than 10 ms.
    const samples = track([
      [1, 0.0005],
      [0.5, 0.6],
    ]);

    const found = detectTransients([samples], RATE);

    expect(found).toHaveLength(1);
    expect(found[0]).toBeGreaterThan(1 - TOLERANCE_SEC);
    expect(found[0]).toBeLessThan(1 + TOLERANCE_SEC);
  });

  it("finds four hits in a row of four", () => {
    const samples = track([
      [0.2, 0.0005],
      [0.1, 0.6],
      [0.2, 0.0005],
      [0.1, 0.6],
      [0.2, 0.0005],
      [0.1, 0.6],
      [0.2, 0.0005],
      [0.1, 0.6],
    ]);

    expect(detectTransients([samples], RATE)).toHaveLength(4);
  });

  it("finds nothing in a steady tone", () => {
    // Nothing rises, so nothing is a transient. A detector that marked the
    // start of every file would be useless as a magnet.
    expect(detectTransients([track([[2, 0.5]])], RATE)).toHaveLength(0);
  });

  it("finds nothing in silence", () => {
    expect(detectTransients([track([[2, 0]])], RATE)).toHaveLength(0);
  });

  it("ignores a rise that stays under the floor", () => {
    // Noise wandering about in a quiet room doubles in level all the time.
    const samples = track([
      [1, 0.00001],
      [1, 0.0005],
    ]);

    expect(detectTransients([samples], RATE)).toHaveLength(0);
  });

  it("returns times in ascending order, which the magnet's search needs", () => {
    const samples = track([
      [0.2, 0.0005],
      [0.1, 0.6],
      [0.3, 0.0005],
      [0.1, 0.6],
    ]);

    const found = detectTransients([samples], RATE);
    expect([...found].sort((a, b) => a - b)).toEqual(found);
  });

  it("hears a hit that arrives on one channel only", () => {
    const left = track([
      [1, 0.0005],
      [0.5, 0.6],
    ]);
    const right = track([[1.5, 0.0005]]);

    expect(detectTransients([left, right], RATE)).toHaveLength(1);
  });
});

describe("onsetsFromLevels", () => {
  it("keeps one onset per attack, not one per hop of it", () => {
    // A single hit rises over several hops. Reported three times, the magnet
    // would have three places to land inside one drum.
    const swell = Float32Array.from([-60, -40, -30, -22, -20, -20, -20]);
    expect(onsetsFromLevels(swell)).toHaveLength(1);
  });

  it("keeps the hop that rose hardest of a cluster", () => {
    const levels = Float32Array.from([-60, -52, -20, -19]);
    expect(onsetsFromLevels(levels)).toEqual([2]);
  });

  it("separates two hits further apart than the minimum spacing", () => {
    const hops = Math.round(TRANSIENT_DEFAULTS.minSpacingMs / TRANSIENT_WINDOW_MS);
    const levels = new Float32Array(hops * 4).fill(-40);

    levels[1] = -10;
    levels[1 + hops * 2] = -10;

    expect(onsetsFromLevels(levels)).toHaveLength(2);
  });

  it("never reports the first hop, which has nothing to rise from", () => {
    expect(onsetsFromLevels(Float32Array.from([-10, -10]))).toEqual([]);
  });

  it("answers for an empty track", () => {
    expect(onsetsFromLevels(new Float32Array(0))).toEqual([]);
  });
});

describe("nearestTransient", () => {
  const times = [1, 2, 5, 9];

  it("finds the one just before", () => {
    expect(nearestTransient(times, 2.05, 0.1)).toBe(2);
  });

  it("finds the one just after", () => {
    expect(nearestTransient(times, 1.95, 0.1)).toBe(2);
  });

  it("finds an exact hit", () => {
    expect(nearestTransient(times, 5, 0.1)).toBe(5);
  });

  it("finds the first and the last", () => {
    expect(nearestTransient(times, 0.95, 0.1)).toBe(1);
    expect(nearestTransient(times, 9.05, 0.1)).toBe(9);
  });

  it("lets go outside the radius", () => {
    // A user must be able to put an edge where there is no transient, and the
    // magnet must not drag it across the screen to the nearest one.
    expect(nearestTransient(times, 7, 0.1)).toBeNull();
  });

  it("takes the radius exactly, not almost", () => {
    // 0.25 and 2.25, not 0.1 and 2.1. A tenth is not exact in binary, so
    // `2.1 - 2` is 0.10000000000000009 and a test written that way would be
    // asking arithmetic for something it cannot give.
    expect(nearestTransient(times, 2.25, 0.25)).toBe(2);
    expect(nearestTransient(times, 2.26, 0.25)).toBeNull();
  });

  it("answers for a track nothing was found in", () => {
    expect(nearestTransient([], 5, 1)).toBeNull();
  });

  it("picks the closer of two candidates", () => {
    expect(nearestTransient([1, 2], 1.6, 1)).toBe(2);
    expect(nearestTransient([1, 2], 1.4, 1)).toBe(1);
  });
});

describe("the magnet's measurements", () => {
  it("measures its radius in pixels, so it scales with zoom", () => {
    // In seconds it would grab a region from the other side of the screen when
    // zoomed out, and reach nothing when zoomed in.
    expect(SNAP_RADIUS_PX).toBeGreaterThan(0);
  });

  it("hops at the resolution the acceptance states", () => {
    expect(TRANSIENT_WINDOW_MS).toBe(10);
    expect(transientWindowSamples(44100)).toBe(441);
  });

  it("never hops zero samples, even at an absurd rate", () => {
    expect(transientWindowSamples(1)).toBe(1);
  });
});
