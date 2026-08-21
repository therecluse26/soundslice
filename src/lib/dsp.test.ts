import { describe, expect, it } from "vitest";
import {
  dbToGain,
  fadeTimes,
  gainToDb,
  maxAmplitude,
  peakNormalizationGain,
  joinedTimeline,
  regionFrameCount,
  rmsDbWindows,
} from "./dsp";

/**
 * The first test in this repo. Its job is to prove the runner works, and to fix
 * the pattern every later DSP test follows: plain arrays in, one number out, no
 * Web Audio anywhere.
 *
 * `vitest` is imported explicitly rather than taken from globals, so `tsc`
 * type-checks this file during `pnpm build` without a `types` entry.
 */
describe("maxAmplitude", () => {
  it("returns 0 for no channels", () => {
    expect(maxAmplitude([])).toBe(0);
  });

  it("returns 0 for silence", () => {
    expect(maxAmplitude([new Float32Array(128)])).toBe(0);
  });

  it("finds the peak in one channel", () => {
    expect(maxAmplitude([new Float32Array([0.1, 0.7, 0.3])])).toBeCloseTo(0.7);
  });

  it("counts a negative peak, because amplitude is absolute", () => {
    expect(maxAmplitude([new Float32Array([0.2, -0.9, 0.4])])).toBeCloseTo(0.9);
  });

  it("takes the loudest channel, not the first", () => {
    const left = new Float32Array([0.2, 0.3]);
    const right = new Float32Array([0.2, 0.95]);
    expect(maxAmplitude([left, right])).toBeCloseTo(0.95);
  });

  it("does not clamp above full scale", () => {
    // Decoded audio can exceed 1.0. Clamping here would hide clipping from the
    // limiter, which is the thing that is supposed to catch it.
    expect(maxAmplitude([new Float32Array([1.4])])).toBeCloseTo(1.4);
  });
});

describe("dbToGain and gainToDb", () => {
  it("makes 0 dB unity", () => {
    expect(dbToGain(0)).toBe(1);
  });

  it("makes −6 dB roughly half", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 4);
  });

  it("round-trips", () => {
    expect(gainToDb(dbToGain(-0.95))).toBeCloseTo(-0.95, 10);
  });

  it("reports silence as minus infinity, not NaN", () => {
    expect(gainToDb(0)).toBe(-Infinity);
  });
});

describe("peakNormalizationGain", () => {
  it("is 1 over the peak at a target of 0 dBFS", () => {
    // This is the number `normalize` in `audio-processors.ts` computed, and it
    // is what "Normalize Levels? Yes" must keep doing.
    expect(peakNormalizationGain(0.5, 0)).toBeCloseTo(2);
  });

  it("leaves silence alone instead of dividing by zero", () => {
    // A silent region used to give Infinity, and Infinity times any sample is
    // NaN. The whole buffer came out as NaN.
    expect(peakNormalizationGain(0, 0)).toBe(1);
  });

  it("turns a hot region down to reach a target below full scale", () => {
    expect(peakNormalizationGain(1, -6)).toBeCloseTo(0.5012, 4);
  });
});

describe("fadeTimes", () => {
  it("puts the 20 ms default fades at each edge", () => {
    expect(fadeTimes(10, 20, 20)).toEqual({ fadeInEnd: 0.02, fadeOutStart: 9.98 });
  });

  it("shortens both fades together when they will not fit", () => {
    // 20 ms plus 20 ms in a 30 ms region. The old per-sample loop multiplied
    // the same samples by both factors and dipped in the middle.
    const { fadeInEnd, fadeOutStart } = fadeTimes(0.03, 20, 20);
    expect(fadeInEnd).toBeCloseTo(0.015, 6);
    expect(fadeOutStart).toBeCloseTo(0.015, 6);
  });

  it("allows no fade at all", () => {
    expect(fadeTimes(10, 0, 0)).toEqual({ fadeInEnd: 0, fadeOutStart: 10 });
  });

  it("reports both edges at zero for an empty region", () => {
    expect(fadeTimes(0, 20, 20)).toEqual({ fadeInEnd: 0, fadeOutStart: 0 });
  });
});

describe("regionFrameCount", () => {
  it("rounds rather than truncating", () => {
    // 0.5 s at 44100 is 22050 frames exactly; 0.50001 s is 22050.44, which the
    // old `createBuffer(duration * sampleRate)` truncated.
    expect(regionFrameCount(0, 0.50001, 44100)).toBe(22050);
    expect(regionFrameCount(0, 0.500015, 44100)).toBe(22051);
  });

  it("never returns zero, because OfflineAudioContext rejects it", () => {
    expect(regionFrameCount(5, 5, 44100)).toBe(1);
  });
});

describe("rmsDbWindows", () => {
  /** `size` samples alternating between +amplitude and −amplitude. */
  const steady = (amplitude: number, size: number) =>
    Float32Array.from({ length: size }, (_, i) =>
      i % 2 === 0 ? amplitude : -amplitude
    );

  it("reads full scale as 0 dBFS", () => {
    expect(rmsDbWindows([steady(1, 8)], 8)[0]).toBeCloseTo(0, 6);
  });

  it("reads half amplitude as about −6 dBFS", () => {
    expect(rmsDbWindows([steady(0.5, 8)], 8)[0]).toBeCloseTo(-6.0206, 3);
  });

  it("reads silence as −Infinity, not 0", () => {
    // A comparison against a threshold is then correct with no special case.
    // `NaN` would silently be false on both sides of every comparison.
    expect(rmsDbWindows([new Float32Array(8)], 8)[0]).toBe(-Infinity);
  });

  it("gives one number per window", () => {
    expect(rmsDbWindows([steady(1, 40)], 8)).toHaveLength(5);
  });

  it("keeps a short last window rather than dropping it", () => {
    // Dropping it would lose up to one window of audio at the end of every
    // file, which for split on silence means losing the last phrase.
    expect(rmsDbWindows([steady(1, 20)], 8)).toHaveLength(3);
  });

  it("averages across every channel", () => {
    // One channel at full scale and one silent is half the energy, so 3 dB
    // below full scale — not 0 dBFS, and not −Infinity.
    const both = rmsDbWindows([steady(1, 8), new Float32Array(8)], 8)[0];
    expect(both).toBeCloseTo(-3.0103, 3);
  });

  it("answers for no channels and for no samples", () => {
    expect(rmsDbWindows([], 8)).toHaveLength(0);
    expect(rmsDbWindows([new Float32Array(0)], 8)).toHaveLength(0);
  });

  it("never divides by a window of zero samples", () => {
    expect(rmsDbWindows([steady(1, 4)], 0)).toHaveLength(4);
  });

  it("reads a subarray, so a chunked scan costs no memory", () => {
    // `region-tools.ts` slices the channels with `subarray` and calls this per
    // chunk. A copy per chunk would double peak memory on a 45-minute track.
    const whole = steady(1, 32);
    const half = whole.subarray(16, 32);

    expect(Array.from(rmsDbWindows([half], 8))).toEqual(
      Array.from(rmsDbWindows([whole], 8)).slice(2)
    );
  });
});

describe("joinedTimeline", () => {
  it("gives no spans and one frame for no regions", () => {
    // Total, so no caller can produce NaN. `renderRegions` throws before it
    // ever reaches here, and an OfflineAudioContext rejects a length of 0.
    expect(joinedTimeline([], 30, 48000)).toEqual({ spans: [], frameCount: 1 });
  });

  it("gives one region exactly what regionFrameCount gives it", () => {
    // **This is the test that says Join-off did not change.** The whole design
    // rests on a single region being today's render, byte for byte.
    for (const [start, end] of [
      [0, 10],
      [1, 4.5],
      [6.25, 9.75],
      [0.333, 7.111],
    ]) {
      const joined = joinedTimeline([{ start, end }], 30, 48000);
      expect(joined.frameCount).toBe(regionFrameCount(start, end, 48000));
      expect(joined.spans[0].frameCount).toBe(joined.frameCount);
    }
  });

  it("hands one region the three numbers source.start already gets", () => {
    const [span] = joinedTimeline([{ start: 1.5, end: 4 }], 30, 48000).spans;

    expect(span.atFrame).toBe(0);
    expect(span.atSec).toBe(0);
    expect(span.sourceStartSec).toBe(1.5);
    expect(span.durationSec).toBe(2.5);
  });

  it("butt-joins two regions with no gap and no overlap", () => {
    const joined = joinedTimeline(
      [
        { start: 1, end: 4.5 },
        { start: 6.25, end: 9.75 },
      ],
      30,
      48000
    );

    expect(joined.spans[0].atFrame).toBe(0);
    expect(joined.spans[1].atFrame).toBe(joined.spans[0].frameCount);
    expect(joined.frameCount).toBe(
      joined.spans[0].frameCount + joined.spans[1].frameCount
    );
  });

  it("keeps whole-frame offsets across a thousand regions", () => {
    // A seconds-accumulating implementation passes the two-region test above
    // and fails this one. 0.0213 s at 44100 is 939.33 frames — the kind of
    // number that drifts.
    const regions = Array.from({ length: 1000 }, (_, index) => ({
      start: index * 0.0213,
      end: index * 0.0213 + 0.0213,
    }));

    const joined = joinedTimeline(regions, 3600, 44100);
    const each = Math.round(0.0213 * 44100);

    for (const span of joined.spans) expect(Number.isInteger(span.atFrame)).toBe(true);
    expect(joined.spans[999].atFrame).toBe(999 * each);
  });

  it("totals the rounded spans, not the rounding of the total", () => {
    // Three spans of 0.6 of a frame each. Every one rounds **up** to 1, so the
    // spans occupy 3 frames — while the seconds add to 1.8 frames, which rounds
    // to 2. Summing seconds first would build a context two frames long and
    // then write three frames into it.
    const regions = [
      { start: 0, end: 0.0000125 },
      { start: 1, end: 1.0000125 },
      { start: 2, end: 2.0000125 },
    ];

    const joined = joinedTimeline(regions, 30, 48000);
    const summed = joined.spans.reduce((total, span) => total + span.frameCount, 0);

    expect(joined.frameCount).toBe(summed);
    expect(joined.frameCount).toBe(3);
    expect(joined.frameCount).not.toBe(
      Math.round(regions.reduce((t, r) => t + (r.end - r.start), 0) * 48000)
    );
  });

  it("derives atSec from atFrame exactly, never by accumulating seconds", () => {
    const joined = joinedTimeline(
      [
        { start: 0, end: 1.0 / 3 },
        { start: 5, end: 5 + 1.0 / 3 },
        { start: 9, end: 9 + 1.0 / 3 },
      ],
      30,
      44100
    );

    for (const span of joined.spans) {
      expect(span.atSec).toBe(span.atFrame / 44100);
    }
  });

  it("keeps the order it was given and never sorts", () => {
    // `orderedRegions` owns the order. `dsp.ts` must not hold a domain opinion,
    // and the join strip will one day hand it an order that is not start time.
    const joined = joinedTimeline(
      [
        { start: 9, end: 10 },
        { start: 1, end: 3 },
      ],
      30,
      48000
    );

    expect(joined.spans[0].sourceStartSec).toBe(9);
    expect(joined.spans[1].sourceStartSec).toBe(1);
  });

  it("clamps a region that runs past the end of the file", () => {
    const [span] = joinedTimeline([{ start: 8, end: 99 }], 10, 48000).spans;

    expect(span.sourceStartSec).toBe(8);
    expect(span.sourceStartSec + span.durationSec).toBe(10);
  });

  it("gives a region entirely past the end no room at all", () => {
    // The floor lives on the total, not on a span. A 1-frame floor here would
    // put every later region one frame late, and the error would compound.
    const joined = joinedTimeline(
      [
        { start: 0, end: 2 },
        { start: 50, end: 60 },
        { start: 2, end: 4 },
      ],
      10,
      48000
    );

    expect(joined.spans[1].frameCount).toBe(0);
    expect(joined.spans[2].atFrame).toBe(joined.spans[1].atFrame);
    expect(joined.frameCount).toBe(4 * 48000);
  });

  it("gives an inverted region zero frames, never negative", () => {
    const joined = joinedTimeline(
      [
        { start: 5, end: 2 },
        { start: 0, end: 1 },
      ],
      30,
      48000
    );

    expect(joined.spans[0].durationSec).toBe(0);
    expect(joined.spans[0].frameCount).toBe(0);
    expect(joined.spans[1].atFrame).toBe(0);
  });

  it("clamps a region starting before zero", () => {
    const [span] = joinedTimeline([{ start: -4, end: 2 }], 30, 48000).spans;

    expect(span.sourceStartSec).toBe(0);
    expect(span.durationSec).toBe(2);
  });

  it("still gives one frame when every region is empty", () => {
    const joined = joinedTimeline(
      [
        { start: 50, end: 60 },
        { start: 70, end: 80 },
      ],
      10,
      48000
    );

    expect(joined.frameCount).toBe(1);
  });

  it("emits an overlap twice, because a join concatenates by length", () => {
    // Two regions covering 0..10 and 5..15 make a twenty-second output, not a
    // fifteen-second one. A join lays audio end to end; it does not merge.
    const joined = joinedTimeline(
      [
        { start: 0, end: 10 },
        { start: 5, end: 15 },
      ],
      30,
      48000
    );

    expect(joined.frameCount).toBe(20 * 48000);
  });

  it("gives the same seconds at two rates, and proportional frames", () => {
    const regions = [
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ];

    const at44 = joinedTimeline(regions, 30, 44100);
    const at48 = joinedTimeline(regions, 30, 48000);

    expect(at44.spans.map((s) => s.durationSec)).toEqual(
      at48.spans.map((s) => s.durationSec)
    );
    expect(at44.frameCount).toBe(3 * 44100);
    expect(at48.frameCount).toBe(3 * 48000);
  });
});
