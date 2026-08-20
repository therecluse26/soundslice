import { beforeEach, describe, expect, it } from "vitest";
import { scheduleRegionEnvelope } from "./graph";
import { PREVIEW_MEASURE_LIMIT_SEC, measuresUnasked } from "./preview";
import {
  forgetMeasurements,
  measurementKey,
  recallMeasurement,
  rememberMeasurement,
} from "./preview-measurements";
import { Region, defaultRegion } from "./edit-stack";
import { OutputFormat } from "./output-format";

/**
 * Records what was written to an `AudioParam`, so the envelope can be tested in
 * plain `node`.
 *
 * The three methods are the whole of the automation API this code uses. Anything
 * else it started calling would fail loudly here rather than silently in a
 * browser.
 */
type Written =
  | { at: number; set: number }
  | { at: number; rampTo: number }
  | { cancelFrom: number };

function fakeParam() {
  const written: Written[] = [];

  const param = {
    cancelScheduledValues: (at: number) => written.push({ cancelFrom: at }),
    setValueAtTime: (value: number, at: number) =>
      written.push({ at, set: value }),
    linearRampToValueAtTime: (value: number, at: number) =>
      written.push({ at, rampTo: value }),
  } as unknown as AudioParam;

  return { param, written };
}

/** A region with fades, and no gain change, so the level is 1. */
function faded(inMs: number, outMs: number, seconds = 10): Region {
  return { ...defaultRegion(0, seconds), fade: { inMs, outMs } };
}

describe("scheduleRegionEnvelope, from the start", () => {
  it("ramps up from silence and down to silence", () => {
    const { param, written } = fakeParam();
    scheduleRegionEnvelope(param, faded(1000, 2000), 10, 0, 100);

    expect(written).toEqual([
      { cancelFrom: 100 },
      { at: 100, set: 0 },
      { at: 101, rampTo: 1 },
      { at: 108, set: 1 },
      { at: 110, rampTo: 0 },
    ]);
  });

  it("holds one level when there are no fades", () => {
    const { param, written } = fakeParam();
    scheduleRegionEnvelope(param, faded(0, 0), 10, 0, 0);

    expect(written).toEqual([
      { cancelFrom: 0 },
      { at: 0, set: 1 },
    ]);
  });

  it("applies the region's own gain", () => {
    const { param, written } = fakeParam();
    const region = { ...faded(0, 0), gainDb: -6 };
    scheduleRegionEnvelope(param, region, 10, 0, 0);

    // −6 dB is half the amplitude, near enough.
    expect(written[1]).toMatchObject({ at: 0 });
    const set = written[1] as { set: number };
    expect(set.set).toBeCloseTo(0.501, 3);
  });
});

describe("scheduleRegionEnvelope, resuming from a seek", () => {
  it("picks up part way through the fade in", () => {
    const { param, written } = fakeParam();
    // 2-second fade in, seeking to 0.5 s: a quarter of the way up.
    scheduleRegionEnvelope(param, faded(2000, 0), 10, 0.5, 0);

    expect(written).toEqual([
      { cancelFrom: 0 },
      { at: 0, set: 0.25 },
      { at: 1.5, rampTo: 1 },
    ]);
  });

  it("picks up part way through the fade out", () => {
    const { param, written } = fakeParam();
    // 4-second fade out starting at 6 s, seeking to 8 s: half way down.
    scheduleRegionEnvelope(param, faded(0, 4000), 10, 8, 0);

    expect(written).toEqual([
      { cancelFrom: 0 },
      { at: 0, set: 0.5 },
      { at: 2, rampTo: 0 },
    ]);
  });

  it("does not re-run a fade in that is already over", () => {
    const { param, written } = fakeParam();
    scheduleRegionEnvelope(param, faded(1000, 1000), 10, 5, 0);

    expect(written).toEqual([
      { cancelFrom: 0 },
      { at: 0, set: 1 },
      { at: 4, set: 1 },
      { at: 5, rampTo: 0 },
    ]);
  });

  it("clamps a position past the end of the region", () => {
    const { param, written } = fakeParam();
    scheduleRegionEnvelope(param, faded(0, 2000), 10, 999, 0);

    expect(written).toEqual([
      { cancelFrom: 0 },
      { at: 0, set: 0 },
      { at: 0, rampTo: 0 },
    ]);
  });

  it("cancels whatever an earlier play scheduled", () => {
    const { param, written } = fakeParam();
    scheduleRegionEnvelope(param, faded(1000, 1000), 10, 0, 42);

    // Without this, a seek would leave the old ramps in place and the two would
    // fight over the same param.
    expect(written[0]).toEqual({ cancelFrom: 42 });
  });
});

describe("measuresUnasked", () => {
  it("measures ten minutes and under", () => {
    expect(PREVIEW_MEASURE_LIMIT_SEC).toBe(600);
    expect(measuresUnasked(defaultRegion(0, 30))).toBe(true);
    expect(measuresUnasked(defaultRegion(0, 600))).toBe(true);
    expect(measuresUnasked(defaultRegion(100, 700))).toBe(true);
  });

  it("stops above ten minutes", () => {
    expect(measuresUnasked(defaultRegion(0, 601))).toBe(false);
    expect(measuresUnasked(defaultRegion(0, 2700))).toBe(false);
  });

  it("measures the region, not the file", () => {
    // A 45-minute file with a 30-second region is a 30-second measurement.
    expect(measuresUnasked(defaultRegion(1000, 1030))).toBe(true);
  });
});

describe("the measurement cache", () => {
  const region = defaultRegion(0, 30);
  const stack = [{ op: "limiter" as const, ceilingDb: -0.95 }];
  const gains = new Map([[0, 0.5]]);

  beforeEach(forgetMeasurements);

  it("gives back what it was told", () => {
    const key = measurementKey("a.wav", region, stack, 44100);
    rememberMeasurement(key, gains);

    expect(recallMeasurement(key)).toBe(gains);
  });

  it("knows nothing about a key it has not seen", () => {
    expect(recallMeasurement(measurementKey("a.wav", region, stack, 44100)))
      .toBeUndefined();
  });

  it("separates two files", () => {
    rememberMeasurement(measurementKey("a.wav", region, stack, 44100), gains);

    expect(recallMeasurement(measurementKey("b.wav", region, stack, 44100)))
      .toBeUndefined();
  });

  it("is invalidated by a moved region", () => {
    rememberMeasurement(measurementKey("a.wav", region, stack, 44100), gains);

    const moved = defaultRegion(0, 30.5);
    expect(recallMeasurement(measurementKey("a.wav", moved, stack, 44100)))
      .toBeUndefined();
  });

  it("is invalidated by a changed stack", () => {
    rememberMeasurement(measurementKey("a.wav", region, stack, 44100), gains);

    const louder = [{ op: "loudness" as const, targetLufs: -14, ceilingDbTp: -1 }];
    expect(recallMeasurement(measurementKey("a.wav", region, louder, 44100)))
      .toBeUndefined();
  });

  it("is invalidated by a changed sample rate", () => {
    // Changing the output format can change the render rate, and the gain with
    // it. Preview must not keep answering with the old format's number.
    rememberMeasurement(measurementKey("a.wav", region, stack, 44100), gains);

    expect(recallMeasurement(measurementKey("a.wav", region, stack, 48000)))
      .toBeUndefined();
  });

  it("drops the least recently used once it is full", () => {
    for (let i = 0; i < 40; i++) {
      rememberMeasurement(measurementKey(`f${i}.wav`, region, stack, 44100), gains);
    }

    expect(recallMeasurement(measurementKey("f0.wav", region, stack, 44100)))
      .toBeUndefined();
    expect(recallMeasurement(measurementKey("f39.wav", region, stack, 44100)))
      .toBe(gains);
  });

  it("keeps an entry alive by reading it", () => {
    const first = measurementKey("keep.wav", region, stack, 44100);
    rememberMeasurement(first, gains);

    for (let i = 0; i < 31; i++) {
      rememberMeasurement(measurementKey(`f${i}.wav`, region, stack, 44100), gains);
      // Touching it moves it back to the end of the queue.
      recallMeasurement(first);
    }

    expect(recallMeasurement(first)).toBe(gains);
  });
});

describe("the key is a string, so it can be a Map key", () => {
  it("does not depend on object identity", () => {
    const a = measurementKey("a.wav", defaultRegion(0, 30), [], 44100);
    const b = measurementKey("a.wav", defaultRegion(0, 30), [], 44100);

    expect(a).toBe(b);
  });

  it("keeps formats apart through their rate", () => {
    // Nothing else in the key names the format, so this is the check that the
    // rate is really in there.
    expect(OutputFormat.MP3).toBe("mp3");
    expect(measurementKey("a.wav", defaultRegion(0, 30), [], 44100)).not.toBe(
      measurementKey("a.wav", defaultRegion(0, 30), [], 48000)
    );
  });
});
