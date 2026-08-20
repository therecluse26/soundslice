/**
 * Split on silence — one region per non-silent stretch.
 *
 * A **region tool**: it makes and moves regions and it never changes how the
 * audio sounds, so it is not an operation and it is not on the edit stack
 * ([`designs/edit-stack.md`](../../.wayfinder/designs/edit-stack.md) §3).
 *
 * Plain maths over `Float32Array` and plain numbers, so Vitest reads it under
 * Node — `dsp.ts`'s rule. Decoding, chunking and progress live in
 * [`region-tools.ts`](./region-tools.ts), which is allowed to touch an
 * `AudioBuffer` because nothing tests it in Node.
 *
 * ## This is not the old Trim Silence
 *
 * `trimSilence` was a master toolbar switch that read an `AnalyserNode` **before**
 * the offline render ran, so it read zeros and could not work as written. Its
 * control was commented out before this map existed and `ExportSettings` dropped
 * the field in ticket 008. This is its replacement and the shape is different: a
 * tool that makes regions, not a switch that changes sound.
 *
 * ## The padding rule, and why the fade never has to move
 *
 * A region already owns `fade: { inMs, outMs }`, defaulting to
 * `DEFAULT_FADE_MS` — 20 ms, the fade every slice has had since before this map
 * existed. **The padding must be at least as long as the fade**, or the ramp
 * eats the attack, which is the exact fault the fade is there to prevent.
 *
 * `clampSilenceSettings` makes that true by construction:
 *
 * - padding is never below `DEFAULT_FADE_MS`;
 * - a silence is never counted below `2 × DEFAULT_FADE_MS`.
 *
 * An interior edge takes at most **half** the gap as padding, so its padding is
 * at least `min(padding, minSilence / 2)` — and both of those are at least
 * 20 ms. So every interior edge has a ramp that sits entirely inside the
 * silence, and the fade itself stays at the default. Nothing has to be
 * shortened, and there is nothing to pop.
 *
 * A region that starts where the **file** starts has no silence in front of it
 * and gets no padding. Its fade stays at the default too: a 20 ms ramp over real
 * audio is far better than the click that opening at full level would make.
 */

import { dbToGain, rmsDbWindows } from "./dsp";
import { DEFAULT_FADE_MS, Region, defaultRegion } from "./edit-stack";

export type SilenceSettings = {
  /** Below this level, a window is silence. In dBFS. */
  thresholdDb: number;
  /** A quiet stretch shorter than this is not silence. In milliseconds. */
  minSilenceMs: number;
  /** Silence kept at each end of a region. In milliseconds. */
  paddingMs: number;
};

/**
 * Where the three settings start.
 *
 * −40 dBFS is well below speech and well above the noise floor of a decent
 * recording. 500 ms is a pause a listener hears as a break rather than as
 * phrasing. 100 ms of padding is five times the fade, so the ramp has room.
 *
 * These are a starting point a user changes, not a claim that they are right for
 * every recording.
 */
export const SILENCE_DEFAULTS: SilenceSettings = {
  thresholdDb: -40,
  minSilenceMs: 500,
  paddingMs: 100,
};

/** What the three controls may be set to. */
export const SILENCE_RANGES = {
  thresholdDb: { min: -80, max: -10, step: 1 },
  minSilenceMs: { min: 2 * DEFAULT_FADE_MS, max: 5000, step: 10 },
  paddingMs: { min: DEFAULT_FADE_MS, max: 1000, step: 10 },
} as const;

/**
 * The window the level is measured over, in milliseconds.
 *
 * 20 ms is about one pitch period of a low male voice, so a window never lands
 * entirely inside one glottal closure and reads as silence. It is also the
 * resolution of every edge this tool produces, and the padding hides that.
 */
export const SILENCE_WINDOW_MS = 20;

/** One non-silent stretch, already padded. */
export type SilenceSpan = {
  start: number;
  end: number;
  /** Silence actually kept at the front, in ms. Zero at the file's own start. */
  padInMs: number;
  /** Silence actually kept at the back, in ms. Zero at the file's own end. */
  padOutMs: number;
};

/**
 * The settings as this tool will really use them.
 *
 * Clamped, not refused. A user who types 5 ms of padding has asked for something
 * that would make every region click, and the honest answer is to do the nearest
 * sane thing and let the control show what happened — a refusal they cannot act
 * on teaches them nothing.
 */
export function clampSilenceSettings(settings: SilenceSettings): SilenceSettings {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  return {
    thresholdDb: clamp(
      settings.thresholdDb,
      SILENCE_RANGES.thresholdDb.min,
      SILENCE_RANGES.thresholdDb.max
    ),
    minSilenceMs: clamp(
      settings.minSilenceMs,
      SILENCE_RANGES.minSilenceMs.min,
      SILENCE_RANGES.minSilenceMs.max
    ),
    paddingMs: clamp(
      settings.paddingMs,
      SILENCE_RANGES.paddingMs.min,
      SILENCE_RANGES.paddingMs.max
    ),
  };
}

/** How many samples one measuring window holds at this rate. */
export function silenceWindowSamples(sampleRate: number): number {
  return Math.max(1, Math.round((sampleRate * SILENCE_WINDOW_MS) / 1000));
}

/**
 * The non-silent stretches of a whole track.
 *
 * The one-call answer, for a caller that already holds every sample. A caller
 * that must not block the page measures in chunks with `rmsDbWindows` and calls
 * `spansFromLevels` with the result — that is what `region-tools.ts` does.
 */
export function splitOnSilence(
  channels: Float32Array[],
  sampleRate: number,
  settings: SilenceSettings
): SilenceSpan[] {
  const windowSamples = silenceWindowSamples(sampleRate);
  const levels = rmsDbWindows(channels, windowSamples);
  const durationSec = (channels[0]?.length ?? 0) / sampleRate;

  return spansFromLevels(
    levels,
    windowSamples / sampleRate,
    durationSec,
    settings
  );
}

/**
 * Turns a track's window levels into padded regions.
 *
 * Four steps, in order:
 *
 * 1. Mark each window loud or quiet against the threshold.
 * 2. **A quiet run shorter than the minimum is not silence.** The gap between
 *    two words is quiet and is not a break, and without this rule a sentence
 *    would come back as one region per syllable.
 * 3. Keep the loud runs. The silence between them is dropped, which is what
 *    this tool is for.
 * 4. Pad each edge back out into the silence it was cut from.
 *
 * An interior edge takes **half the gap at most**, so two neighbours cannot pad
 * into each other and duplicate the same audio. Overlap is legal for regions a
 * user makes; it would be a surprise here.
 */
export function spansFromLevels(
  levels: Float32Array,
  windowSec: number,
  durationSec: number,
  settings: SilenceSettings
): SilenceSpan[] {
  const { thresholdDb, minSilenceMs, paddingMs } = clampSilenceSettings(settings);

  const minSilenceWindows = Math.max(
    1,
    Math.ceil(minSilenceMs / 1000 / windowSec)
  );

  // Step 1 and 2 together: walk the windows, and let a short quiet run keep the
  // loud run it interrupts alive.
  const loud: Array<{ from: number; to: number }> = [];
  let runStart = -1;
  let quietSince = -1;

  for (let window = 0; window <= levels.length; window++) {
    const isLoud = window < levels.length && levels[window] > thresholdDb;

    if (isLoud) {
      if (runStart < 0) runStart = window;
      quietSince = -1;
      continue;
    }

    if (runStart < 0) continue;

    if (quietSince < 0) quietSince = window;

    // The run ends when the quiet has lasted long enough to count as silence,
    // or when the track does.
    if (window - quietSince >= minSilenceWindows || window === levels.length) {
      loud.push({ from: runStart, to: quietSince });
      runStart = -1;
      quietSince = -1;
    }
  }

  const paddingSec = paddingMs / 1000;

  return loud.map((run, index) => {
    const start = run.from * windowSec;
    const end = Math.min(durationSec, run.to * windowSec);

    const before = index === 0 ? start : start - loud[index - 1].to * windowSec;
    const after =
      index === loud.length - 1
        ? durationSec - end
        : loud[index + 1].from * windowSec - end;

    // Half the gap at an interior edge; all of it at the file's own edges,
    // where there is no neighbour to share with.
    const padIn = Math.max(
      0,
      Math.min(paddingSec, index === 0 ? before : before / 2)
    );
    const padOut = Math.max(
      0,
      Math.min(paddingSec, index === loud.length - 1 ? after : after / 2)
    );

    return {
      start: Math.max(0, start - padIn),
      end: Math.min(durationSec, end + padOut),
      padInMs: padIn * 1000,
      padOutMs: padOut * 1000,
    };
  });
}

/**
 * The spans as regions the store can hold.
 *
 * Every region keeps the default fade. The padding rule above is what makes that
 * safe, so there is no per-edge fade arithmetic here and nothing to get wrong.
 */
export function regionsFromSpans(spans: SilenceSpan[]): Region[] {
  return spans.map((span) => defaultRegion(span.start, span.end));
}

/**
 * True when this span's ramps both sit inside the silence it was padded with.
 *
 * The invariant the padding rule promises, written down so a test can assert it
 * rather than a comment claiming it. A file edge has no silence to sit in and is
 * exempt — there is no boundary there to pop.
 */
export function rampsSitInSilence(
  span: SilenceSpan,
  durationSec: number,
  fadeMs = DEFAULT_FADE_MS
): boolean {
  const inOk = span.start <= 0 || span.padInMs >= fadeMs;
  const outOk = span.end >= durationSec || span.padOutMs >= fadeMs;
  return inOk && outOk;
}

/** The linear amplitude a threshold in dBFS means. For callers that gate. */
export function silenceThresholdAmplitude(thresholdDb: number): number {
  return dbToGain(thresholdDb);
}
