import { describe, expect, it } from "vitest";
import { defaultRegion, Region } from "./edit-stack";
import {
  formatClock,
  formatFades,
  formatGain,
  formatStretch,
  regionRows,
} from "./region-table";

const at = (id: string, start: number, end: number): Region => ({
  ...defaultRegion(start, end),
  id,
});

const a = at("a", 0, 1);
const b = at("b", 2, 3);
const c = at("c", 4, 5);

describe("region rows", () => {
  it("are in start-time order with join off, whatever the layout says", () => {
    const rows = regionRows([c, a, b], { order: ["c", "b", "a"] }, false);
    expect(rows.map((row) => row.region.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it("are the join order with join on, keeping each region's number", () => {
    const rows = regionRows([a, b, c], { order: ["c", "a", "b"] }, true);
    expect(rows.map((row) => row.region.id)).toEqual(["c", "a", "b"]);
    expect(rows.map((row) => row.number)).toEqual([3, 1, 2]);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it("give the first row no seam and every other row its crossfade", () => {
    const rows = regionRows([a, b, c], { crossfadeMs: { b: 40, a: 99 } }, true);
    expect(rows.map((row) => row.crossfadeMs)).toEqual([null, 40, 0]);
  });

  it("label a named region by its name", () => {
    const rows = regionRows([{ ...a, name: "Intro" }, b], undefined, false);
    expect(rows.map((row) => row.label)).toEqual(["Intro", "Region 2"]);
  });
});

describe("formatting", () => {
  it("writes times to the hundredth", () => {
    expect(formatClock(0)).toBe("0:00.00");
    expect(formatClock(70.4)).toBe("1:10.40");
    expect(formatClock(5.256)).toBe("0:05.26");
  });

  it("signs gains with a real minus", () => {
    expect(formatGain(0)).toBe("0.0 dB");
    expect(formatGain(2)).toBe("+2.0 dB");
    expect(formatGain(-3.5)).toBe("−3.5 dB");
  });

  it("writes fades in then out", () => {
    expect(formatFades({ ...a, fade: { inMs: 5, outMs: 10 } })).toBe("5 / 10 ms");
  });

  it("writes only what a stretch changes", () => {
    expect(formatStretch(a)).toBe("—");
    expect(formatStretch({ ...a, stretch: { rate: 1, semitones: 0 } })).toBe("—");
    expect(formatStretch({ ...a, stretch: { rate: 1.1, semitones: -1 } })).toBe("1.10× · −1 st");
    expect(formatStretch({ ...a, stretch: { rate: 1, semitones: 12 } })).toBe("+12 st");
  });
});
