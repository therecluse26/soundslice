import { describe, expect, it } from "vitest";
import {
  ATTACK_FADE_IN_MS,
  TAIL_FADE_OUT_MS,
  regionsFromOnsets,
} from "./transient-split";

describe("regionsFromOnsets", () => {
  it("gives nothing for a file with no attacks", () => {
    expect(regionsFromOnsets([], 10)).toEqual([]);
  });

  it("cuts one region per attack, starting just before it", () => {
    const regions = regionsFromOnsets([1, 2, 3], 4, {
      minRegionMs: 100,
      leadInMs: 10,
    });

    expect(regions.map((r) => r.start)).toEqual([0.99, 1.99, 2.99]);
  });

  it("tiles the file: each region ends where the next begins", () => {
    const regions = regionsFromOnsets([1, 2, 3], 4);

    expect(regions[0].end).toBe(regions[1].start);
    expect(regions[1].end).toBe(regions[2].start);
    expect(regions[2].end).toBe(4);
  });

  it("keeps the attack: a short fade-in, never the 20 ms default", () => {
    const [region] = regionsFromOnsets([1], 4, { minRegionMs: 100, leadInMs: 10 });

    expect(region.fade.inMs).toBe(ATTACK_FADE_IN_MS);
    expect(region.fade.outMs).toBe(TAIL_FADE_OUT_MS);
  });

  it("has no fade-in at all with no lead-in, so the onset is not ramped", () => {
    const [region] = regionsFromOnsets([1], 4, { minRegionMs: 100, leadInMs: 0 });
    expect(region.fade.inMs).toBe(0);
    expect(region.start).toBe(1);
  });

  it("makes one region of attacks closer than the minimum", () => {
    // A flam is one hit.
    const regions = regionsFromOnsets([1, 1.03, 2], 4, {
      minRegionMs: 100,
      leadInMs: 0,
    });

    expect(regions.map((r) => r.start)).toEqual([1, 2]);
  });

  it("folds a hit in the last moments of the file into the region before", () => {
    const regions = regionsFromOnsets([1, 3.98], 4, {
      minRegionMs: 100,
      leadInMs: 0,
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].end).toBe(4);
  });

  it("gives every region its own id", () => {
    const ids = regionsFromOnsets([1, 2, 3], 4).map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });
});
