import { describe, expect, it } from "vitest";
import { openTrackName, overviewPeaks } from "./workspace";

describe("the open track", () => {
  it("is the chosen one while it is loaded", () => {
    expect(openTrackName(["a", "b"], "b")).toBe("b");
  });

  it("falls back to the first when none is chosen or it was removed", () => {
    expect(openTrackName(["a", "b"], null)).toBe("a");
    expect(openTrackName(["a", "b"], "gone")).toBe("a");
    expect(openTrackName([], "a")).toBeUndefined();
  });
});

describe("overview peaks", () => {
  it("takes the loudest absolute value of every channel per point", () => {
    const left = [0.1, -0.9, 0.2, 0.3];
    const right = [0.5, 0.0, -0.4, 0.1];
    expect(overviewPeaks([left, right], 2)).toEqual([0.9, 0.4]);
  });

  it("is empty for no audio and never above 1", () => {
    expect(overviewPeaks([], 10)).toEqual([]);
    expect(overviewPeaks([[2, -3]], 1)).toEqual([1]);
  });
});
