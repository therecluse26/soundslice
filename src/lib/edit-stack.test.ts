import { describe, expect, it } from "vitest";
import {
  CANONICAL_ORDER,
  COMPRESSOR_DEFAULTS,
  EditStack,
  LIMITER_DEFAULTS,
  Region,
  defaultRegion,
  firstRegion,
  needsMeasurement,
  orderedRegions,
  regionAudioSignature,
  regionLabel,
  regionNumber,
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
    // `id` is checked separately. Ticket 021 added it, and it is the one field
    // whose value is different on every call.
    const { id, ...rest } = defaultRegion(1, 30);

    expect(typeof id).toBe("string");
    expect(rest).toEqual({
      start: 1,
      end: 30,
      gainDb: 0,
      fade: { inMs: 20, outMs: 20 },
    });
  });

  it("gives every region an id of its own", () => {
    const ids = [1, 2, 3, 4].map(() => defaultRegion(0, 1).id);
    expect(new Set(ids).size).toBe(4);
  });
});

/** A region with fixed bounds and a chosen id, so an ordering test can be read. */
function at(id: string, start: number, end: number, name?: string): Region {
  return { ...defaultRegion(start, end), id, name };
}

describe("orderedRegions", () => {
  it("orders by start time, whatever order they were made in", () => {
    const regions = [at("c", 30, 40), at("a", 0, 10), at("b", 10, 20)];

    expect(orderedRegions(regions).map((region) => region.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps overlapping regions, because overlap is allowed", () => {
    // Two takes of one phrase is a real thing to want. Ticket 021 decided it.
    const regions = [at("b", 5, 15), at("a", 0, 10)];

    expect(orderedRegions(regions).map((region) => region.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("breaks a tie the same way twice", () => {
    // Without a total order two regions at the same start would swap between
    // renders, and the numbers in the list would move under the pointer.
    const regions = [at("b", 5, 9), at("a", 5, 9)];

    expect(orderedRegions(regions).map((r) => r.id)).toEqual(
      orderedRegions([...regions].reverse()).map((r) => r.id)
    );
  });

  it("does not change the array it is given", () => {
    const regions = [at("c", 30, 40), at("a", 0, 10)];
    orderedRegions(regions);

    expect(regions.map((region) => region.id)).toEqual(["c", "a"]);
  });

  it("answers for an empty track", () => {
    expect(orderedRegions([])).toEqual([]);
  });
});

describe("firstRegion", () => {
  it("is the first by start time, which is what Simple view exports", () => {
    expect(firstRegion([at("c", 30, 40), at("a", 2, 10)])?.id).toBe("a");
  });

  it("is undefined for a track with no regions", () => {
    // Zero regions is legal. Every caller has to answer for it rather than
    // skipping quietly, which is the shape of the defect ticket 016 fixed.
    expect(firstRegion([])).toBeUndefined();
  });
});

describe("regionNumber and regionLabel", () => {
  const regions = [at("c", 30, 40), at("a", 0, 10), at("b", 10, 20, "chorus")];

  it("numbers from the start of the track, counting from one", () => {
    expect(regionNumber(regions, "a")).toBe(1);
    expect(regionNumber(regions, "b")).toBe(2);
    expect(regionNumber(regions, "c")).toBe(3);
  });

  it("falls back to the number when there is no name", () => {
    expect(regionLabel(regions, regions[1])).toBe("Region 1");
  });

  it("uses the name when there is one", () => {
    expect(regionLabel(regions, regions[2])).toBe("chorus");
  });

  it("treats a name of spaces as no name", () => {
    const blank = [at("a", 0, 10, "   ")];
    expect(regionLabel(blank, blank[0])).toBe("Region 1");
  });

  it("renumbers when a region moves past its neighbour", () => {
    // `c` was third. Dragged to the front of the track it becomes first, and
    // every number after it moves down. Ticket 023 relies on this: an unnamed
    // region's exported file name carries this number.
    const moved = regions.map((region) =>
      region.id === "c" ? { ...region, start: 0, end: 5 } : region
    );

    expect(regionNumber(regions, "c")).toBe(3);
    expect(regionNumber(moved, "c")).toBe(1);
    expect(regionNumber(moved, "a")).toBe(2);
  });
});

describe("regionAudioSignature", () => {
  const region = at("a", 0, 10);

  it("ignores the id and the name, which change no sample", () => {
    expect(regionAudioSignature({ ...region, id: "z", name: "chorus" })).toEqual(
      regionAudioSignature(region)
    );
  });

  it("changes when the bounds move", () => {
    expect(regionAudioSignature({ ...region, end: 10.5 })).not.toEqual(
      regionAudioSignature(region)
    );
  });

  it("changes when the gain or a fade moves", () => {
    expect(regionAudioSignature({ ...region, gainDb: -6 })).not.toEqual(
      regionAudioSignature(region)
    );

    expect(
      regionAudioSignature({ ...region, fade: { inMs: 0, outMs: 20 } })
    ).not.toEqual(regionAudioSignature(region));
  });
});
