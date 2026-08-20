import { describe, expect, it } from "vitest";
import {
  CANONICAL_ORDER,
  COMPRESSOR_DEFAULTS,
  EditStack,
  LIMITER_DEFAULTS,
  defaultRegion,
  needsMeasurement,
  simpleStack,
  sortToCanonical,
} from "./edit-stack";

/** The `op` names of a stack, which is the only thing most of these check. */
const names = (stack: EditStack) => stack.map((operation) => operation.op);

describe("simpleStack", () => {
  it("always ends with the limiter", () => {
    // Design section 5: on by default, last, and Simple view never turns it
    // off. Ticket 013 was this promise being made and not kept.
    for (const normalizeAudio of [false, true]) {
      for (const applyPostProcessing of [false, true]) {
        const stack = simpleStack({ normalizeAudio, applyPostProcessing });
        expect(stack[stack.length - 1].op).toBe("limiter");
      }
    }
  });

  it("is the limiter alone with both switches off", () => {
    expect(
      names(simpleStack({ normalizeAudio: false, applyPostProcessing: false }))
    ).toEqual(["limiter"]);
  });

  it("adds the compressor for post-processing alone", () => {
    expect(
      names(simpleStack({ normalizeAudio: false, applyPostProcessing: true }))
    ).toEqual(["compressor", "limiter"]);
  });

  it("uses loudness, not peak, for normalize alone", () => {
    // Ticket 010. "This will make the levels more consistent" is what the
    // switch's tooltip promises, and two tracks can share a peak and sound
    // nothing alike.
    expect(
      names(simpleStack({ normalizeAudio: true, applyPostProcessing: false }))
    ).toEqual(["loudness", "limiter"]);
  });

  it("normalizes twice with both on, and the two are different operations", () => {
    // Not a mistake, and not the canonical order.
    //
    // The first is **gain staging**: it lifts a quiet recording to the
    // compressor's −8 dB threshold so the compressor engages at all. Peak
    // normalization is the right tool for that, and keeping it means the
    // compressor hears exactly what it heard before ticket 010.
    //
    // The last sets **the level you hear**, which is loudness.
    expect(
      names(simpleStack({ normalizeAudio: true, applyPostProcessing: true }))
    ).toEqual(["peakNormalization", "compressor", "loudness", "limiter"]);
  });

  it("defaults the loudness target to −14 LUFS with a −1 dBTP ceiling", () => {
    const [loudness] = simpleStack({
      normalizeAudio: true,
      applyPostProcessing: false,
    });
    expect(loudness).toEqual({
      op: "loudness",
      targetLufs: -14,
      ceilingDbTp: -1,
    });
  });

  it("takes a target Advanced view has set", () => {
    const [loudness] = simpleStack({
      normalizeAudio: true,
      applyPostProcessing: false,
      loudnessTargetLufs: -23,
    });
    expect(loudness).toMatchObject({ op: "loudness", targetLufs: -23 });
  });

  it("ignores the target entirely when normalize is off", () => {
    expect(
      names(
        simpleStack({
          normalizeAudio: false,
          applyPostProcessing: true,
          loudnessTargetLufs: -23,
        })
      )
    ).toEqual(["compressor", "limiter"]);
  });

  it("keeps the compressor's five numbers exactly as they were", () => {
    // Threshold −8 dB, ratio 4, knee 0, attack 8 ms, release 50 ms. Change one
    // and every existing user's "Apply Post Processing? Yes" sounds different.
    const [compressor] = simpleStack({
      normalizeAudio: false,
      applyPostProcessing: true,
    });
    expect(compressor).toEqual({
      op: "compressor",
      thresholdDb: -8,
      ratio: 4,
      kneeDb: 0,
      attackMs: 8,
      releaseMs: 50,
    });
  });

  it("keeps the limiter's ceiling exactly as it was", () => {
    expect(LIMITER_DEFAULTS.ceilingDb).toBe(-0.95);
  });

  it("hands out fresh objects, never the shared defaults", () => {
    // Two tracks exporting at once must not share one operation object, or
    // editing either edits both.
    const first = simpleStack({
      normalizeAudio: false,
      applyPostProcessing: true,
    });
    expect(first[0]).not.toBe(COMPRESSOR_DEFAULTS);
    expect(first[0]).toEqual(COMPRESSOR_DEFAULTS);
  });
});

describe("needsMeasurement", () => {
  it("is true for the two operations that must hear the whole region first", () => {
    expect(needsMeasurement({ op: "peakNormalization", targetDbfs: 0 })).toBe(
      true
    );
    expect(
      needsMeasurement({ op: "loudness", targetLufs: -14, ceilingDbTp: -1 })
    ).toBe(true);
  });

  it("is false for everything a node can do in one pass", () => {
    expect(needsMeasurement({ op: "gain", db: -3 })).toBe(false);
    expect(needsMeasurement({ op: "limiter", ceilingDb: -0.95 })).toBe(false);
    expect(needsMeasurement({ op: "eq", bands: [] })).toBe(false);
  });

  it("counts the passes Simple view's worst case costs", () => {
    // Each measuring operation costs one extra render pass. Both switches on is
    // three passes, against the four full renders it replaces.
    const stack = simpleStack({
      normalizeAudio: true,
      applyPostProcessing: true,
    });
    expect(stack.filter(needsMeasurement)).toHaveLength(2);
  });
});

describe("sortToCanonical", () => {
  it("puts a scrambled stack back in the canonical order", () => {
    const scrambled: EditStack = [
      { op: "limiter", ceilingDb: -0.95 },
      { op: "gain", db: -3 },
      { op: "eq", bands: [] },
    ];
    expect(names(sortToCanonical(scrambled))).toEqual([
      "eq",
      "gain",
      "limiter",
    ]);
  });

  it("keeps the user's order between two operations of the same name", () => {
    const stack: EditStack = [
      { op: "gain", db: 1 },
      { op: "gain", db: 2 },
    ];
    expect(sortToCanonical(stack)).toEqual(stack);
  });

  it("does not modify the stack it is given", () => {
    const stack: EditStack = [
      { op: "limiter", ceilingDb: -0.95 },
      { op: "gain", db: -3 },
    ];
    sortToCanonical(stack);
    expect(names(stack)).toEqual(["limiter", "gain"]);
  });

  it("names every operation in the union", () => {
    // A name added to `Operation` and forgotten here would sort to index −1 and
    // silently jump to the front of every stack.
    expect(CANONICAL_ORDER).toHaveLength(7);
    expect(new Set(CANONICAL_ORDER).size).toBe(7);
  });
});

describe("defaultRegion", () => {
  it("carries the 20 ms fades every slice has always had", () => {
    expect(defaultRegion(1, 30)).toEqual({
      start: 1,
      end: 30,
      gainDb: 0,
      fade: { inMs: 20, outMs: 20 },
    });
  });
});
