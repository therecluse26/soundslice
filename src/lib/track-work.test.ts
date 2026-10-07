import { describe, expect, it } from "vitest";
import { Region, defaultRegion } from "./edit-stack";
import { OutputFormat } from "./output-format";
import {
  copyWork,
  crossfadeInto,
  effectiveExportSettings,
  hasExportOverrides,
  isJoinReordered,
  joinOrdered,
} from "./track-work";
import {
  moveInJoin,
  shiftInJoin,
  tidyJoin,
  withCrossfade,
  withStartTimeOrder,
} from "./join-layout";

function at(id: string, start: number, end: number): Region {
  return { ...defaultRegion(start, end), id };
}

const A = at("a", 0, 1);
const B = at("b", 2, 3);
const C = at("c", 4, 5);
const REGIONS = [C, A, B];

const MASTER = {
  normalizeAudio: false,
  applyPostProcessing: false,
  exportFileType: OutputFormat.WAV,
  bitDepth: 16 as const,
  outputSampleRate: 48000,
};

describe("effectiveExportSettings", () => {
  it("is the master when nothing is overridden", () => {
    expect(effectiveExportSettings(MASTER, undefined)).toBe(MASTER);
  });

  it("lays each override over the master", () => {
    const settings = effectiveExportSettings(MASTER, {
      exportFileType: OutputFormat.FLAC,
      bitDepth: 24,
    });

    expect(settings.exportFileType).toBe(OutputFormat.FLAC);
    expect(settings.bitDepth).toBe(24);
    expect(settings.outputSampleRate).toBe(48000);
  });

  it("reads a null rate as the file's own rate, not as no override", () => {
    expect(
      effectiveExportSettings(MASTER, { outputSampleRate: null }).outputSampleRate
    ).toBeUndefined();
  });
});

describe("hasExportOverrides", () => {
  it("is false for nothing and for keys set to undefined", () => {
    expect(hasExportOverrides(undefined)).toBe(false);
    expect(hasExportOverrides({ bitDepth: undefined })).toBe(false);
  });

  it("is true for a null rate, which is a real choice", () => {
    expect(hasExportOverrides({ outputSampleRate: null })).toBe(true);
  });
});

describe("joinOrdered", () => {
  it("is start-time order with no layout", () => {
    expect(joinOrdered(REGIONS, undefined)).toEqual([A, B, C]);
  });

  it("follows the stored order, then adds newcomers by start time", () => {
    expect(joinOrdered(REGIONS, { order: ["c", "a"] })).toEqual([C, A, B]);
  });

  it("skips an id whose region is gone", () => {
    expect(joinOrdered([A, B], { order: ["gone", "b", "a"] })).toEqual([B, A]);
  });
});

describe("editing the join", () => {
  it("shifts a region one place and writes the whole order", () => {
    const layout = shiftInJoin(REGIONS, undefined, "a", 1);
    expect(layout?.order).toEqual(["b", "a", "c"]);
    expect(isJoinReordered(REGIONS, layout)).toBe(true);
  });

  it("does nothing past either end", () => {
    expect(shiftInJoin(REGIONS, undefined, "a", -1)).toBeUndefined();
  });

  it("moves a region to where another stood", () => {
    expect(moveInJoin(REGIONS, undefined, "c", "a")?.order).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps the crossfades when the order is reset", () => {
    const layout = withCrossfade({ order: ["b", "a", "c"] }, "a", 40);
    const reset = withStartTimeOrder(layout);

    expect(reset).toEqual({ crossfadeMs: { a: 40 } });
    expect(crossfadeInto(reset, "a")).toBe(40);
  });

  it("removes a crossfade set to zero, and an empty layout is none", () => {
    expect(withCrossfade({ crossfadeMs: { a: 40 } }, "a", 0)).toBeUndefined();
    expect(tidyJoin({ order: [], crossfadeMs: {} })).toBeUndefined();
  });
});

describe("copyWork", () => {
  it("shares nothing the user can edit", () => {
    const work = {
      regions: [A],
      exportOverrides: { bitDepth: 24 as const },
      join: { order: ["a"], crossfadeMs: { a: 10 } },
    };
    const copy = copyWork(work);

    expect(copy.regions[0]).not.toBe(A);
    expect(copy.exportOverrides).not.toBe(work.exportOverrides);
    expect(copy.join?.order).not.toBe(work.join.order);
    expect(copy).toEqual({ ...work, selectedRegionId: undefined, stack: undefined });
  });
});
