import { describe, expect, it } from "vitest";
import {
  CLIP_HOLD_MS,
  METER_DECAY_DB_PER_SEC,
  METER_FLOOR_DB,
  PEAK_HOLD_MS,
  advanceMeter,
  emptyMeter,
  formatMeterDb,
  isClipped,
  levelDb,
  meterFraction,
  meterIsIdle,
} from "./meter";
import { peakOf, rmsOf } from "./dsp";

describe("peakOf", () => {
  it("finds the loudest sample whichever way it points", () => {
    // `toBeCloseTo`, not `toBe`: a `Float32Array` cannot hold 0.8 exactly, and
    // an analyser hands us one of those, never a plain array.
    expect(peakOf(new Float32Array([0.1, -0.8, 0.3]))).toBeCloseTo(0.8, 6);
  });

  it("reads an empty window as silence", () => {
    expect(peakOf(new Float32Array(0))).toBe(0);
  });
});

describe("rmsOf", () => {
  it("reads a full-scale square wave as full scale", () => {
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 6);
  });

  it("reads a sine at −3.01 dB, which is where a sine sits", () => {
    const samples = new Float32Array(1024);
    for (let index = 0; index < samples.length; index++) {
      samples[index] = Math.sin((2 * Math.PI * index) / 1024);
    }

    // A sine's RMS is its peak divided by the square root of two.
    expect(rmsOf(samples)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(levelDb(rmsOf(samples))).toBeCloseTo(-3.01, 1);
  });

  it("reads an empty window as silence rather than dividing by zero", () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
  });
});

describe("levelDb", () => {
  it("reads full scale as zero", () => {
    expect(levelDb(1)).toBeCloseTo(0, 6);
  });

  it("never returns minus infinity, which cannot be drawn", () => {
    expect(levelDb(0)).toBe(METER_FLOOR_DB);
    expect(Number.isFinite(levelDb(0))).toBe(true);
  });

  it("clamps anything under the floor to the floor", () => {
    expect(levelDb(0.0000001)).toBe(METER_FLOOR_DB);
  });
});

describe("meterFraction", () => {
  it("puts the floor at the bottom and full scale at the top", () => {
    expect(meterFraction(METER_FLOOR_DB)).toBe(0);
    expect(meterFraction(0)).toBe(1);
  });

  it("is linear in decibels, so −30 dB is halfway", () => {
    expect(meterFraction(-30)).toBeCloseTo(0.5, 6);
    expect(meterFraction(-15)).toBeCloseTo(0.75, 6);
  });

  it("stays full above full scale rather than running off the top", () => {
    expect(meterFraction(6)).toBe(1);
  });
});

describe("advanceMeter", () => {
  it("rises instantly", () => {
    const state = advanceMeter(emptyMeter(), { rms: 0.5, peak: 0.9 }, 0, 0.016);

    expect(state.db).toBeCloseTo(levelDb(0.5), 6);
    expect(state.peakDb).toBeCloseTo(levelDb(0.9), 6);
  });

  it("falls at the decay rate, not instantly", () => {
    const loud = advanceMeter(emptyMeter(), { rms: 1, peak: 1 }, 0, 0.016);
    const later = advanceMeter(loud, { rms: 0, peak: 0 }, 500, 0.5);

    // Half a second at 20 dB per second is 10 dB down from full scale.
    expect(later.db).toBeCloseTo(-METER_DECAY_DB_PER_SEC * 0.5, 6);
  });

  it("never falls below the floor however long it decays", () => {
    const loud = advanceMeter(emptyMeter(), { rms: 1, peak: 1 }, 0, 0.016);
    const later = advanceMeter(loud, { rms: 0, peak: 0 }, 10000, 10);

    expect(later.db).toBe(METER_FLOOR_DB);
  });

  it("measures decay in seconds elapsed, not in frames drawn", () => {
    const loud = advanceMeter(emptyMeter(), { rms: 1, peak: 1 }, 0, 0.016);

    const oneLongFrame = advanceMeter(loud, { rms: 0, peak: 0 }, 200, 0.2);
    const twoShortFrames = advanceMeter(
      advanceMeter(loud, { rms: 0, peak: 0 }, 100, 0.1),
      { rms: 0, peak: 0 },
      200,
      0.1
    );

    expect(oneLongFrame.db).toBeCloseTo(twoShortFrames.db, 6);
  });

  it("holds the peak line for its hold time, then lets it go", () => {
    const hit = advanceMeter(emptyMeter(), { rms: 0.1, peak: 1 }, 0, 0.016);
    expect(hit.peakDb).toBeCloseTo(0, 6);

    const during = advanceMeter(hit, { rms: 0, peak: 0 }, PEAK_HOLD_MS - 1, 0.5);
    expect(during.peakDb).toBeCloseTo(0, 6);

    const after = advanceMeter(hit, { rms: 0, peak: 0 }, PEAK_HOLD_MS + 1, 0.5);
    expect(after.peakDb).toBe(METER_FLOOR_DB);
  });

  it("lights the clip warning at exactly full scale, not only past it", () => {
    const state = advanceMeter(emptyMeter(), { rms: 0.5, peak: 1 }, 0, 0.016);

    expect(isClipped(state, 0)).toBe(true);
    expect(isClipped(state, CLIP_HOLD_MS - 1)).toBe(true);
    expect(isClipped(state, CLIP_HOLD_MS)).toBe(false);
  });

  it("does not light the clip warning below full scale", () => {
    const state = advanceMeter(emptyMeter(), { rms: 0.9, peak: 0.999 }, 0, 0.016);
    expect(isClipped(state, 0)).toBe(false);
  });

  it("keeps the clip warning lit while the bar falls away", () => {
    const clipped = advanceMeter(emptyMeter(), { rms: 1, peak: 1 }, 0, 0.016);
    const quiet = advanceMeter(clipped, { rms: 0, peak: 0 }, 500, 0.5);

    expect(isClipped(quiet, 500)).toBe(true);
  });
});

describe("formatMeterDb", () => {
  it("writes the floor as an infinity sign, not as a number", () => {
    expect(formatMeterDb(METER_FLOOR_DB)).toBe("−∞");
    expect(formatMeterDb(-999)).toBe("−∞");
  });

  it("writes a real minus sign, matching the region readout", () => {
    expect(formatMeterDb(-12.34)).toBe("−12.3");
    expect(formatMeterDb(-12.34).charCodeAt(0)).toBe(0x2212);
  });

  it("writes zero as +0.0 rather than −0.0", () => {
    expect(formatMeterDb(-0.001)).toBe("+0.0");
    expect(formatMeterDb(0)).toBe("+0.0");
  });
});

describe("meterIsIdle", () => {
  it("is idle when every meter is at the floor and nothing is clipped", () => {
    expect(meterIsIdle([emptyMeter(), emptyMeter()], 1000)).toBe(true);
  });

  it("is not idle while one meter still shows something", () => {
    const loud = advanceMeter(emptyMeter(), { rms: 0.5, peak: 0.5 }, 0, 0.016);
    expect(meterIsIdle([emptyMeter(), loud], 0)).toBe(false);
  });

  it("is not idle while a clip warning is still lit", () => {
    const clipped = advanceMeter(emptyMeter(), { rms: 1, peak: 1 }, 0, 0.016);
    const settled = advanceMeter(clipped, { rms: 0, peak: 0 }, 5000, 60);

    expect(settled.db).toBe(METER_FLOOR_DB);
    expect(meterIsIdle([settled], 1000)).toBe(false);
    expect(meterIsIdle([settled], CLIP_HOLD_MS)).toBe(true);
  });
});
