import { describe, expect, it } from "vitest";
import {
  SILENCE_DEFAULTS,
  SILENCE_RANGES,
  SILENCE_WINDOW_MS,
  clampSilenceSettings,
  rampsSitInSilence,
  regionsFromSpans,
  silenceWindowSamples,
  spansFromLevels,
  splitOnSilence,
} from "./silence";
import { DEFAULT_FADE_MS } from "./edit-stack";

const RATE = 8000;

/**
 * A mono track built from a script of `[seconds, amplitude]` pairs.
 *
 * 8 kHz because nothing here cares about frequency, and a 30-second track is
 * then 240,000 samples rather than 1.3 million.
 */
function track(script: Array<[number, number]>): Float32Array {
  const total = script.reduce((sum, [seconds]) => sum + seconds, 0);
  const samples = new Float32Array(Math.round(total * RATE));

  let at = 0;
  for (const [seconds, amplitude] of script) {
    const frames = Math.round(seconds * RATE);

    for (let i = 0; i < frames; i++) {
      // Alternating sign, so RMS equals the amplitude exactly and a threshold
      // in dBFS means what the test says it means.
      samples[at + i] = i % 2 === 0 ? amplitude : -amplitude;
    }

    at += frames;
  }

  return samples;
}

/** Loud enough to be sound at −40 dBFS: −6 dBFS. */
const LOUD = 0.5;
/** Quiet enough to be silence at −40 dBFS: about −60 dBFS. */
const QUIET = 0.001;

describe("clampSilenceSettings", () => {
  it("leaves sensible settings alone", () => {
    expect(clampSilenceSettings(SILENCE_DEFAULTS)).toEqual(SILENCE_DEFAULTS);
  });

  it("never lets padding fall below the fade", () => {
    // The padding rule. A padding shorter than the fade means the ramp eats the
    // attack, which is the exact fault the fade is there to prevent.
    const clamped = clampSilenceSettings({ ...SILENCE_DEFAULTS, paddingMs: 5 });
    expect(clamped.paddingMs).toBe(DEFAULT_FADE_MS);
  });

  it("never counts a gap shorter than two fades as silence", () => {
    const clamped = clampSilenceSettings({
      ...SILENCE_DEFAULTS,
      minSilenceMs: 1,
    });
    expect(clamped.minSilenceMs).toBe(2 * DEFAULT_FADE_MS);
  });

  it("clamps rather than refuses, at both ends of every range", () => {
    const wild = clampSilenceSettings({
      thresholdDb: 40,
      minSilenceMs: 999999,
      paddingMs: 999999,
    });

    expect(wild.thresholdDb).toBe(SILENCE_RANGES.thresholdDb.max);
    expect(wild.minSilenceMs).toBe(SILENCE_RANGES.minSilenceMs.max);
    expect(wild.paddingMs).toBe(SILENCE_RANGES.paddingMs.max);
  });
});

describe("splitOnSilence", () => {
  it("finds four spoken phrases with clear gaps between them", () => {
    // Ticket 025's acceptance, in the smallest form that means it.
    const samples = track([
      [1, LOUD],
      [1, QUIET],
      [1, LOUD],
      [1, QUIET],
      [1, LOUD],
      [1, QUIET],
      [1, LOUD],
    ]);

    expect(splitOnSilence([samples], RATE, SILENCE_DEFAULTS)).toHaveLength(4);
  });

  it("gives one region for a track with no silence in it", () => {
    const spans = splitOnSilence([track([[5, LOUD]])], RATE, SILENCE_DEFAULTS);

    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeCloseTo(0, 2);
    expect(spans[0].end).toBeCloseTo(5, 1);
  });

  it("gives zero regions for a silent track", () => {
    // Legal. Ticket 021 allows a track to hold none, and the card says the
    // track exports nothing rather than reporting a success.
    expect(splitOnSilence([track([[5, QUIET]])], RATE, SILENCE_DEFAULTS))
      .toHaveLength(0);
  });

  it("does not cut on a gap between two words", () => {
    // 100 ms of quiet is phrasing, not a break. Without the minimum, a sentence
    // would come back as one region per syllable.
    const samples = track([
      [1, LOUD],
      [0.1, QUIET],
      [1, LOUD],
    ]);

    expect(splitOnSilence([samples], RATE, SILENCE_DEFAULTS)).toHaveLength(1);
  });

  it("does cut when the gap is long enough", () => {
    const samples = track([
      [1, LOUD],
      [0.6, QUIET],
      [1, LOUD],
    ]);

    expect(splitOnSilence([samples], RATE, SILENCE_DEFAULTS)).toHaveLength(2);
  });

  it("hears a stereo track on both channels", () => {
    const left = track([[1, LOUD]]);
    const right = track([[1, QUIET]]);

    expect(splitOnSilence([left, right], RATE, SILENCE_DEFAULTS))
      .toHaveLength(1);
  });
});

describe("the three settings each move the result the way they claim", () => {
  const samples = track([
    [1, LOUD],
    [0.6, QUIET],
    [1, LOUD],
  ]);

  it("a lower threshold hears less as silence", () => {
    // −80 dBFS is under the −60 dBFS "quiet" here, so the gap stops counting.
    const spans = splitOnSilence(
      [samples],
      RATE,
      { ...SILENCE_DEFAULTS, thresholdDb: -80 }
    );

    expect(spans).toHaveLength(1);
  });

  it("a longer minimum silence hears fewer breaks", () => {
    const spans = splitOnSilence([samples], RATE, {
      ...SILENCE_DEFAULTS,
      minSilenceMs: 2000,
    });

    expect(spans).toHaveLength(1);
  });

  it("more padding makes every region longer", () => {
    const tight = splitOnSilence([samples], RATE, {
      ...SILENCE_DEFAULTS,
      paddingMs: 20,
    });
    const loose = splitOnSilence([samples], RATE, {
      ...SILENCE_DEFAULTS,
      paddingMs: 250,
    });

    expect(loose[0].end).toBeGreaterThan(tight[0].end);
    expect(loose[1].start).toBeLessThan(tight[1].start);
  });
});

describe("the padding rule", () => {
  const samples = track([
    [1, LOUD],
    [0.6, QUIET],
    [1, LOUD],
    [0.6, QUIET],
    [1, LOUD],
  ]);

  const durationSec = 4.2;

  it("puts every ramp inside the silence, at every interior edge", () => {
    // The invariant the whole rule exists for: with the ramp inside the
    // silence it never touches the attack, and the boundary is still ramped, so
    // there is nothing to pop.
    for (const spans of [
      splitOnSilence([samples], RATE, SILENCE_DEFAULTS),
      splitOnSilence([samples], RATE, {
        ...SILENCE_DEFAULTS,
        paddingMs: DEFAULT_FADE_MS,
      }),
      splitOnSilence([samples], RATE, {
        ...SILENCE_DEFAULTS,
        minSilenceMs: 2 * DEFAULT_FADE_MS,
        paddingMs: DEFAULT_FADE_MS,
      }),
    ]) {
      for (const span of spans) {
        expect(rampsSitInSilence(span, durationSec)).toBe(true);
      }
    }
  });

  it("holds even when the settings asked for a padding under the fade", () => {
    const spans = splitOnSilence([samples], RATE, {
      ...SILENCE_DEFAULTS,
      paddingMs: 1,
    });

    for (const span of spans) {
      expect(rampsSitInSilence(span, durationSec)).toBe(true);
    }
  });

  it("never pads two neighbours into each other", () => {
    // Overlap is legal for a region a user made. Here it would duplicate the
    // same audio in two files, which is a surprise rather than a choice.
    const spans = splitOnSilence([samples], RATE, {
      ...SILENCE_DEFAULTS,
      paddingMs: 1000,
    });

    for (let index = 1; index < spans.length; index++) {
      expect(spans[index].start).toBeGreaterThanOrEqual(spans[index - 1].end);
    }
  });

  it("keeps every region inside the file", () => {
    const spans = splitOnSilence([samples], RATE, {
      ...SILENCE_DEFAULTS,
      paddingMs: 1000,
    });

    for (const span of spans) {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeLessThanOrEqual(durationSec + 1e-9);
    }
  });
});

describe("regionsFromSpans", () => {
  it("gives every region the fade every slice has always had", () => {
    const regions = regionsFromSpans([
      { start: 1, end: 2, padInMs: 100, padOutMs: 100 },
    ]);

    expect(regions[0].fade).toEqual({
      inMs: DEFAULT_FADE_MS,
      outMs: DEFAULT_FADE_MS,
    });
  });

  it("gives every region an id of its own", () => {
    const regions = regionsFromSpans([
      { start: 0, end: 1, padInMs: 0, padOutMs: 100 },
      { start: 2, end: 3, padInMs: 100, padOutMs: 0 },
    ]);

    expect(new Set(regions.map((region) => region.id)).size).toBe(2);
  });
});

describe("spansFromLevels", () => {
  it("keeps a run that reaches the end of the track", () => {
    // The loop has to close the last run when the windows run out, or the final
    // phrase of every file is lost.
    const levels = Float32Array.from([-6, -6, -6]);
    const spans = spansFromLevels(levels, 0.02, 0.06, SILENCE_DEFAULTS);

    expect(spans).toHaveLength(1);
    expect(spans[0].end).toBeCloseTo(0.06, 6);
  });

  it("answers for a track with no windows at all", () => {
    expect(spansFromLevels(new Float32Array(0), 0.02, 0, SILENCE_DEFAULTS))
      .toEqual([]);
  });
});

describe("silenceWindowSamples", () => {
  it("is the window length in samples at this rate", () => {
    expect(silenceWindowSamples(44100)).toBe(
      Math.round((44100 * SILENCE_WINDOW_MS) / 1000)
    );
  });

  it("is never zero, even at an absurd rate", () => {
    expect(silenceWindowSamples(1)).toBe(1);
  });
});
