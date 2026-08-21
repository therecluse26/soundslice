import {
  ADVANCED_FORMATS,
  BIT_DEPTHS,
  BitDepth,
  DEFAULT_BIT_DEPTH,
  OutputFormat,
} from "./output-format";
import { EXPORT_SAMPLE_RATES } from "./audio-format";
import { LOUDNESS_DEFAULTS, LOUDNESS_TARGET_RANGE } from "./edit-stack";

/**
 * The master defaults — the settings the master toolbar holds.
 *
 * `.wayfinder/designs/view-state.md` section 5 calls this "a complete settings
 * object": every key has a value. A track later holds a *partial* of this and
 * overrides only what it disagrees with. Per-track partials arrive with the
 * feature tickets; this file is the master half.
 *
 * Section 7 of the same design says these persist, because they are small and
 * the user set them on purpose. Per-track settings and regions do not persist —
 * they belong to a file the browser cannot re-open.
 */
export type MasterDefaults = {
  normalizeAudio: boolean;
  applyPostProcessing: boolean;

  /**
   * What "Normalize Levels? Yes" aims at, in LUFS.
   *
   * **Simple view never shows this.** It is a master default so Advanced view
   * has somewhere to put the control, and so the choice survives a reload. The
   * ticket's rule is that Simple gains no new control, not that the number
   * cannot exist.
   */
  loudnessTargetLufs: number;

  exportFileType: OutputFormat;

  /**
   * Bits per stored sample, for WAV and FLAC. Advanced view only.
   *
   * MP3 and Opus ignore it, and the control hides for them. The value is kept
   * across that switch rather than reset — standing rule 5, switching views
   * never loses work, and switching format is the same promise.
   */
  bitDepth: BitDepth;

  /**
   * The rate to export at, in hertz, or `null` for **the file's own rate**.
   *
   * `null` and not `undefined`, because this object is `JSON.stringify`d into
   * `localStorage` and `undefined` does not survive that trip.
   */
  outputSampleRate: number | null;

  /**
   * **Join** — one file per track instead of one per region. Advanced only.
   *
   * A master default and not a per-track setting, for the same reason the
   * output format is one: it decides the *shape* of a whole export, and a batch
   * that produced one joined file and five loose regions would be a batch
   * nobody asked for.
   *
   * Simple view has no control for it, and honours it if Advanced view set it —
   * exactly as it honours FLAC, 24-bit and a chosen sample rate. It costs
   * nothing there: Simple exports one region per track, and one region joined is
   * the same file, with the same name. The Advanced settings chip says it is on.
   */
  joinRegions: boolean;
};

export const MASTER_DEFAULTS_STORAGE_KEY = "master-defaults";

/**
 * Version 2 dropped `trimSilence`. Version 3 added `loudnessTargetLufs`.
 * Version 4 added `bitDepth` and `outputSampleRate`. Version 5 added
 * `joinRegions`.
 *
 * `trimSilence` read an `AnalyserNode` before the offline render ran, so it read
 * zeros and could never work. Its control has been commented out since before
 * this map existed, and ticket 008 removed the operation.
 *
 * A stored value of an older version is **discarded, not migrated** — the policy
 * `persisted.ts` states. The cost is that a user who set their switches before
 * this build gets them back at their defaults, once.
 */
export const MASTER_DEFAULTS_STORAGE_VERSION = 5;

export const DEFAULT_MASTER_DEFAULTS: MasterDefaults = {
  normalizeAudio: false,
  applyPostProcessing: false,
  loudnessTargetLufs: LOUDNESS_DEFAULTS.targetLufs,
  exportFileType: OutputFormat.WAV,
  bitDepth: DEFAULT_BIT_DEPTH,
  outputSampleRate: null,
  joinRegions: false,
};

/**
 * Guards what comes back out of `localStorage`.
 *
 * A stored value that fails this check is discarded, not migrated. This is a
 * free tool with no accounts, so a clean reset beats a migration path nobody
 * will test.
 */
export function isMasterDefaults(value: unknown): value is MasterDefaults {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.normalizeAudio === "boolean" &&
    typeof candidate.applyPostProcessing === "boolean" &&
    isLoudnessTarget(candidate.loudnessTargetLufs) &&
    isOutputFormat(candidate.exportFileType) &&
    isBitDepth(candidate.bitDepth) &&
    isOutputSampleRate(candidate.outputSampleRate) &&
    // A plain `typeof`, with no private guard beside it. The guards above exist
    // because those values have a legal *set* as well as a legal type; a boolean
    // has only the two.
    typeof candidate.joinRegions === "boolean"
  );
}

function isBitDepth(value: unknown): value is BitDepth {
  return BIT_DEPTHS.some((depth) => depth === value);
}

/**
 * `null` means the file's own rate. Any other value must be one this app offers.
 *
 * A rate the list does not hold would still export — WAV takes anything — but it
 * would show as an empty select the user cannot get back to a known state.
 */
function isOutputSampleRate(value: unknown): value is number | null {
  return value === null || EXPORT_SAMPLE_RATES.some((rate) => rate === value);
}

/**
 * A stored target outside the range is discarded with the rest of the object.
 *
 * Hand-edited storage is a real case — `persisted.ts` says so — and a target of
 * `-3000` would silence every export without an error anywhere.
 */
function isLoudnessTarget(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= LOUDNESS_TARGET_RANGE.min &&
    value <= LOUDNESS_TARGET_RANGE.max
  );
}

/**
 * Every format, not just Simple view's two.
 *
 * A user who chose FLAC in Advanced view and went back to Simple keeps FLAC:
 * standing rule 5 says switching views never loses work. Simple view's select
 * shows two rows and the stored value is not one of them, so the trigger reads
 * back what is really set rather than silently changing it.
 */
function isOutputFormat(value: unknown): value is OutputFormat {
  return ADVANCED_FORMATS.some((format) => format === value);
}
