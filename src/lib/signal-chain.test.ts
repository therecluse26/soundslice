import { describe, expect, it } from "vitest";
import { CANONICAL_ORDER, EqBand, EditStack } from "./edit-stack";
import {
  BLOCKS,
  COMPRESSOR_FLOOR_DB,
  COMPRESSOR_RANGES,
  DEFAULT_EQ_BANDS,
  EQ_GAIN_RANGE,
  EQ_HZ_RANGE,
  bandResponseDb,
  blockInfo,
  blockSummary,
  clampBand,
  clampCompressor,
  compressorFraction,
  compressorOutputDb,
  defaultOperation,
  eqBandAtPoint,
  eqCurve,
  eqPointX,
  eqPointY,
  eqValuesAtPoint,
  eqGainFraction,
  eqResponseDb,
  formatDb,
  formatRatio,
  fractionCompressorDb,
  fractionEqGain,
  fractionHz,
  gainReductionDb,
  hzFraction,
  operationIn,
  ratioForOutputAtFullScale,
  replaceOperation,
  withOperation,
  withoutOperation,
} from "./signal-chain";

describe("BLOCKS", () => {
  it("is the canonical order, so the picture matches the sound", () => {
    expect(BLOCKS.map((block) => block.op)).toEqual(CANONICAL_ORDER);
  });

  it("names every operation exactly once", () => {
    expect(new Set(BLOCKS.map((block) => block.op)).size).toBe(BLOCKS.length);
  });

  it("marks noise reduction as the one that cannot be built yet", () => {
    expect(BLOCKS.filter((block) => !block.built).map((block) => block.op)).toEqual([
      "noiseReduction",
    ]);
  });

  it("finds a block by name", () => {
    expect(blockInfo("eq").short).toBe("EQ");
  });
});

describe("defaultOperation", () => {
  it("gives an EQ that changes nothing until it is dragged", () => {
    const operation = defaultOperation("eq");
    expect(operation.op).toBe("eq");

    if (operation.op !== "eq") throw new Error("not an eq");
    expect(operation.bands.every((band) => band.db === 0)).toBe(true);
    expect(eqResponseDb(operation.bands, 1000)).toBeCloseTo(0, 6);
  });

  it("gives a fresh band array each time, not the shared default", () => {
    const first = defaultOperation("eq");
    const second = defaultOperation("eq");

    if (first.op !== "eq" || second.op !== "eq") throw new Error("not an eq");
    first.bands[0].db = 6;

    expect(second.bands[0].db).toBe(0);
    expect(DEFAULT_EQ_BANDS[0].db).toBe(0);
  });

  it("gives today's compressor, to the number", () => {
    expect(defaultOperation("compressor")).toEqual({
      op: "compressor",
      thresholdDb: -8,
      ratio: 4,
      kneeDb: 0,
      attackMs: 8,
      releaseMs: 50,
    });
  });

  it("gives a gain of zero, because switching a block on is not an edit", () => {
    expect(defaultOperation("gain")).toEqual({ op: "gain", db: 0 });
  });

  it("refuses noise reduction, which has no profile to build from", () => {
    expect(() => defaultOperation("noiseReduction")).toThrow(/noise profile/);
  });
});

describe("withOperation", () => {
  it("adds the operation in canonical order, not at the end", () => {
    const stack = withOperation(withOperation([], "limiter"), "eq");
    expect(stack.map((one) => one.op)).toEqual(["eq", "limiter"]);
  });

  it("cannot add the same operation twice", () => {
    const once = withOperation([], "compressor");
    expect(withOperation(once, "compressor")).toBe(once);
  });
});

describe("withoutOperation", () => {
  it("takes the operation out and leaves the rest in order", () => {
    const stack = withOperation(withOperation([], "eq"), "limiter");
    expect(withoutOperation(stack, "eq").map((one) => one.op)).toEqual(["limiter"]);
  });

  it("leaves a stack that never had it alone", () => {
    expect(withoutOperation([], "eq")).toEqual([]);
  });
});

describe("replaceOperation", () => {
  it("keeps the operation where it was, so a control cannot reorder the chain", () => {
    const stack: EditStack = [
      { op: "eq", bands: [] },
      { op: "gain", db: 0 },
      { op: "limiter", ceilingDb: -1 },
    ];

    const next = replaceOperation(stack, { op: "gain", db: -6 });

    expect(next.map((one) => one.op)).toEqual(["eq", "gain", "limiter"]);
    expect(operationIn(next, "gain")?.db).toBe(-6);
  });

  it("adds it in canonical order when the stack has none", () => {
    const next = replaceOperation([{ op: "limiter", ceilingDb: -1 }], {
      op: "gain",
      db: 3,
    });

    expect(next.map((one) => one.op)).toEqual(["gain", "limiter"]);
  });

  it("does not change the stack it was given", () => {
    const stack: EditStack = [{ op: "gain", db: 0 }];
    replaceOperation(stack, { op: "gain", db: -6 });

    expect(stack[0]).toEqual({ op: "gain", db: 0 });
  });
});

describe("blockSummary", () => {
  it("says flat for an EQ nobody has moved", () => {
    expect(blockSummary(defaultOperation("eq"))).toBe("flat");
  });

  it("counts the bands that have moved", () => {
    const bands = DEFAULT_EQ_BANDS.map((band) => ({ ...band }));
    bands[0].db = -6;

    expect(blockSummary({ op: "eq", bands })).toBe("1 of 3 moved");
  });

  it("gives the compressor its threshold and its ratio, short enough for a tile", () => {
    expect(blockSummary(defaultOperation("compressor"))).toBe("−8 dB · 4:1");
  });

  it("gives the limiter two places, because a ceiling lives in hundredths", () => {
    expect(blockSummary(defaultOperation("limiter"))).toBe("−0.95 dB");
  });

  it("gives the loudness target in LUFS", () => {
    expect(blockSummary(defaultOperation("loudness"))).toBe("−14 LUFS");
  });
});

describe("formatDb", () => {
  it("writes a real minus sign, matching the region readout", () => {
    expect(formatDb(-6.5)).toBe("−6.5 dB");
    expect(formatDb(-6.5).charCodeAt(0)).toBe(0x2212);
  });

  it("writes zero as positive, never as minus zero", () => {
    expect(formatDb(0)).toBe("+0.0 dB");
    expect(formatDb(-0.001)).toBe("+0.0 dB");
  });

  it("takes a place count, for a ceiling that lives in hundredths", () => {
    expect(formatDb(-0.95, 2)).toBe("−0.95 dB");
  });
});

describe("formatRatio", () => {
  it("drops the decimal on a whole ratio", () => {
    expect(formatRatio(4)).toBe("4:1");
  });

  it("keeps one place on a ratio between whole numbers", () => {
    expect(formatRatio(2.5)).toBe("2.5:1");
  });

  it("calls the node's own maximum a limiter, not 20 to 1", () => {
    expect(formatRatio(COMPRESSOR_RANGES.ratio.max)).toBe("∞:1");
  });
});

describe("hzFraction", () => {
  it("puts the ends of the range at the ends of the picture", () => {
    expect(hzFraction(EQ_HZ_RANGE.min)).toBe(0);
    expect(hzFraction(EQ_HZ_RANGE.max)).toBe(1);
  });

  it("is logarithmic, so every decade takes the same width", () => {
    const first = hzFraction(200) - hzFraction(20);
    const second = hzFraction(2000) - hzFraction(200);

    expect(first).toBeCloseTo(second, 6);
  });

  it("clamps rather than running off the picture", () => {
    expect(hzFraction(5)).toBe(0);
    expect(hzFraction(48000)).toBe(1);
  });

  it("round-trips through fractionHz", () => {
    for (const hz of [20, 100, 440, 1000, 5000, 20000]) {
      expect(fractionHz(hzFraction(hz))).toBeCloseTo(hz, 6);
    }
  });
});

describe("eqGainFraction", () => {
  it("puts the loudest at the top, the way the curve is drawn", () => {
    expect(eqGainFraction(EQ_GAIN_RANGE.max)).toBe(0);
    expect(eqGainFraction(EQ_GAIN_RANGE.min)).toBe(1);
    expect(eqGainFraction(0)).toBeCloseTo(0.5, 6);
  });

  it("round-trips through fractionEqGain", () => {
    for (const db of [-18, -6, 0, 6, 18]) {
      expect(fractionEqGain(eqGainFraction(db))).toBeCloseTo(db, 6);
    }
  });
});

describe("bandResponseDb", () => {
  it("gives a peaking band its own gain at its own frequency", () => {
    const band: EqBand = { type: "peaking", hz: 1000, db: 6, q: 1 };
    expect(bandResponseDb(band, 1000)).toBeCloseTo(6, 2);
  });

  it("leaves a peaking band's far side alone", () => {
    const band: EqBand = { type: "peaking", hz: 1000, db: 6, q: 4 };

    expect(bandResponseDb(band, 20)).toBeCloseTo(0, 1);
    expect(bandResponseDb(band, 18000)).toBeCloseTo(0, 1);
  });

  it("cuts as well as it lifts, by the same amount", () => {
    const up: EqBand = { type: "peaking", hz: 1000, db: 6, q: 1 };
    const down: EqBand = { type: "peaking", hz: 1000, db: -6, q: 1 };

    expect(bandResponseDb(up, 1000)).toBeCloseTo(-bandResponseDb(down, 1000), 2);
  });

  it("passes everything through at 0 dB, whatever the type", () => {
    const types: EqBand["type"][] = ["peaking", "lowshelf", "highshelf"];

    for (const type of types) {
      expect(bandResponseDb({ type, hz: 1000, db: 0, q: 1 }, 500)).toBeCloseTo(0, 6);
      expect(bandResponseDb({ type, hz: 1000, db: 0, q: 1 }, 5000)).toBeCloseTo(0, 6);
    }
  });

  it("gives a low shelf its gain below the corner and nothing above it", () => {
    const band: EqBand = { type: "lowshelf", hz: 200, db: 6, q: 0.7 };

    expect(bandResponseDb(band, 20)).toBeCloseTo(6, 1);
    expect(bandResponseDb(band, 200)).toBeCloseTo(3, 1);
    expect(bandResponseDb(band, 8000)).toBeCloseTo(0, 1);
  });

  it("gives a high shelf its gain above the corner and nothing below it", () => {
    const band: EqBand = { type: "highshelf", hz: 4000, db: -6, q: 0.7 };

    expect(bandResponseDb(band, 18000)).toBeCloseTo(-6, 1);
    expect(bandResponseDb(band, 4000)).toBeCloseTo(-3, 1);
    expect(bandResponseDb(band, 100)).toBeCloseTo(0, 1);
  });

  it("reads a low pass Q in decibels, the way Web Audio does", () => {
    // The tell, and it is exact: a low pass reads **Q decibels** at its own
    // cutoff. A plain-number reading of Q would put a Butterworth corner at
    // −3 dB there instead, and every drawn curve would be wrong by that much.
    for (const q of [-6, 0, 3, 6, 12]) {
      expect(bandResponseDb({ type: "lowpass", hz: 1000, db: 0, q }, 1000)).toBeCloseTo(
        q,
        6
      );
    }

    // Below the cutoff it passes; far above it, it is long gone.
    expect(bandResponseDb({ type: "lowpass", hz: 1000, db: 0, q: 0 }, 100)).toBeCloseTo(
      0,
      1
    );
    expect(
      bandResponseDb({ type: "lowpass", hz: 1000, db: 0, q: 0 }, 10000)
    ).toBeLessThan(-20);
  });

  it("rolls a high pass off downwards", () => {
    const band: EqBand = { type: "highpass", hz: 1000, db: 0, q: 0 };

    expect(bandResponseDb(band, 100)).toBeLessThan(-20);
    expect(bandResponseDb(band, 10000)).toBeCloseTo(0, 1);
  });

  it("never returns a value that cannot be drawn", () => {
    const band: EqBand = { type: "peaking", hz: 30000, db: 12, q: 0.0001 };
    expect(Number.isFinite(bandResponseDb(band, 1000))).toBe(true);
  });
});

describe("eqResponseDb", () => {
  it("adds the bands, because filters in series add in decibels", () => {
    const bands: EqBand[] = [
      { type: "peaking", hz: 1000, db: 4, q: 1 },
      { type: "peaking", hz: 1000, db: 3, q: 1 },
    ];

    expect(eqResponseDb(bands, 1000)).toBeCloseTo(7, 2);
  });

  it("is flat with no bands at all", () => {
    expect(eqResponseDb([], 1000)).toBe(0);
  });
});

describe("eqCurve", () => {
  it("returns one value per column asked for", () => {
    expect(eqCurve(DEFAULT_EQ_BANDS, 320).length).toBe(320);
  });

  it("runs from the bottom of the range to the top", () => {
    const bands: EqBand[] = [{ type: "lowshelf", hz: 200, db: 12, q: 0.7 }];
    const curve = eqCurve(bands, 256);

    expect(curve[0]).toBeCloseTo(bandResponseDb(bands[0], EQ_HZ_RANGE.min), 4);
    expect(curve[255]).toBeCloseTo(bandResponseDb(bands[0], EQ_HZ_RANGE.max), 4);
  });

  it("survives a width of zero, which a hidden canvas reports", () => {
    expect(eqCurve(DEFAULT_EQ_BANDS, 0).length).toBe(0);
  });
});

describe("compressorOutputDb", () => {
  const hard = { thresholdDb: -20, ratio: 4, kneeDb: 0 };

  it("leaves everything below the threshold alone", () => {
    expect(compressorOutputDb(-40, hard)).toBe(-40);
    expect(compressorOutputDb(-20, hard)).toBeCloseTo(-20, 6);
  });

  it("divides what is over the threshold by the ratio", () => {
    // 20 dB over, at 4:1, comes out 5 dB over.
    expect(compressorOutputDb(0, hard)).toBeCloseTo(-15, 6);
  });

  it("passes everything at a ratio of one to one", () => {
    const flat = { thresholdDb: -20, ratio: 1, kneeDb: 0 };
    expect(compressorOutputDb(0, flat)).toBeCloseTo(0, 6);
  });

  it("rounds the corner when there is a knee", () => {
    const soft = { thresholdDb: -20, ratio: 4, kneeDb: 12 };

    // At the threshold itself a knee is already pulling down and a hard corner
    // is not. The amount is exact: (1 − 1/ratio) × knee ÷ 8.
    expect(compressorOutputDb(-20, hard)).toBeCloseTo(-20, 6);
    expect(gainReductionDb(-20, soft)).toBeCloseTo(((1 - 1 / 4) * 12) / 8, 6);

    // Below the knee, and above it, the two agree again.
    expect(compressorOutputDb(-30, soft)).toBeCloseTo(-30, 6);
    expect(compressorOutputDb(-5, soft)).toBeCloseTo(compressorOutputDb(-5, hard), 6);
  });

  it("is continuous across the knee, with no step anywhere", () => {
    const soft = { thresholdDb: -20, ratio: 4, kneeDb: 12 };
    let previous = compressorOutputDb(COMPRESSOR_FLOOR_DB, soft);

    for (let db = COMPRESSOR_FLOOR_DB; db <= 0; db += 0.1) {
      const output = compressorOutputDb(db, soft);
      expect(Math.abs(output - previous)).toBeLessThan(0.2);
      previous = output;
    }
  });

  it("never divides by a knee of zero", () => {
    expect(Number.isFinite(compressorOutputDb(-20, hard))).toBe(true);
  });
});

describe("gainReductionDb", () => {
  it("is nothing below the threshold", () => {
    expect(gainReductionDb(-40, { thresholdDb: -20, ratio: 4, kneeDb: 0 })).toBe(0);
  });

  it("is the distance the curve falls below the line", () => {
    expect(gainReductionDb(0, { thresholdDb: -20, ratio: 4, kneeDb: 0 })).toBeCloseTo(
      15,
      6
    );
  });
});

describe("compressorFraction", () => {
  it("puts the floor at one end and full scale at the other", () => {
    expect(compressorFraction(COMPRESSOR_FLOOR_DB)).toBe(0);
    expect(compressorFraction(0)).toBe(1);
  });

  it("round-trips through fractionCompressorDb", () => {
    for (const db of [-60, -30, -12, 0]) {
      expect(fractionCompressorDb(compressorFraction(db))).toBeCloseTo(db, 6);
    }
  });
});

describe("clampCompressor", () => {
  it("keeps every setting inside the node's own limits", () => {
    const clamped = clampCompressor({
      op: "compressor",
      thresholdDb: -200,
      ratio: 100,
      kneeDb: -5,
      attackMs: 9999,
      releaseMs: -1,
    });

    expect(clamped).toEqual({
      op: "compressor",
      thresholdDb: COMPRESSOR_RANGES.thresholdDb.min,
      ratio: COMPRESSOR_RANGES.ratio.max,
      kneeDb: COMPRESSOR_RANGES.kneeDb.min,
      attackMs: COMPRESSOR_RANGES.attackMs.max,
      releaseMs: COMPRESSOR_RANGES.releaseMs.min,
    });
  });
});

describe("clampBand", () => {
  it("keeps a dragged band inside the picture", () => {
    expect(clampBand({ type: "peaking", hz: 90000, db: 40, q: 0 })).toEqual({
      type: "peaking",
      hz: EQ_HZ_RANGE.max,
      db: EQ_GAIN_RANGE.max,
      q: 0.1,
    });
  });
});

describe("eqBandAtPoint", () => {
  const bands: EqBand[] = [
    { type: "lowshelf", hz: 120, db: 0, q: 0.7 },
    { type: "peaking", hz: 1000, db: 6, q: 1 },
    { type: "highshelf", hz: 6000, db: 0, q: 0.7 },
  ];

  it("grabs the band whose dot is under the pointer", () => {
    const x = eqPointX(1000, 600);
    const y = eqPointY(6, 300);

    expect(eqBandAtPoint(bands, x, y, 600, 300)).toBe(1);
  });

  it("grabs nothing when the pointer is nowhere near a dot", () => {
    expect(eqBandAtPoint(bands, 0, 300, 600, 300)).toBe(-1);
  });

  it("grabs the nearest of two dots on top of each other, not the first", () => {
    const stacked: EqBand[] = [
      { type: "peaking", hz: 1000, db: 0, q: 1 },
      { type: "peaking", hz: 1000, db: 2, q: 1 },
    ];

    // A hair below the second dot, and well inside the first's radius too.
    const y = eqPointY(2, 300) + 2;

    expect(eqBandAtPoint(stacked, eqPointX(1000, 600), y, 600, 300)).toBe(1);
  });
});

describe("eqValuesAtPoint", () => {
  it("is the inverse of where the dot is drawn", () => {
    const band: EqBand = { type: "peaking", hz: 440, db: -7.5, q: 1 };
    const values = eqValuesAtPoint(
      eqPointX(band.hz, 800),
      eqPointY(band.db, 400),
      800,
      400
    );

    expect(values.hz).toBeCloseTo(440, 6);
    expect(values.db).toBeCloseTo(-7.5, 6);
  });

  it("survives a canvas of zero width, which a hidden panel reports", () => {
    expect(eqValuesAtPoint(0, 0, 0, 0).hz).toBe(EQ_HZ_RANGE.min);
  });
});

describe("ratioForOutputAtFullScale", () => {
  it("reads the ratio back off the curve it drew", () => {
    for (const ratio of [1, 2, 4, 8]) {
      const output = compressorOutputDb(0, { thresholdDb: -20, ratio, kneeDb: 0 });
      expect(ratioForOutputAtFullScale(-20, output)).toBeCloseTo(ratio, 6);
    }
  });

  it("is one to one when the handle is dragged back to the diagonal", () => {
    expect(ratioForOutputAtFullScale(-20, 0)).toBeCloseTo(1, 6);
  });

  it("stops at the node's own maximum instead of reaching infinity", () => {
    expect(ratioForOutputAtFullScale(-20, -20)).toBe(COMPRESSOR_RANGES.ratio.max);
    expect(ratioForOutputAtFullScale(-20, -30)).toBe(COMPRESSOR_RANGES.ratio.max);
  });
});
