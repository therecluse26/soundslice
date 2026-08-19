import { OutputFormat } from "./audio-service";

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
  trimSilence: boolean;
  exportFileType: OutputFormat;
};

export const MASTER_DEFAULTS_STORAGE_KEY = "master-defaults";
export const MASTER_DEFAULTS_STORAGE_VERSION = 1;

export const DEFAULT_MASTER_DEFAULTS: MasterDefaults = {
  normalizeAudio: false,
  applyPostProcessing: false,
  trimSilence: false,
  exportFileType: OutputFormat.WAV,
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
    typeof candidate.trimSilence === "boolean" &&
    isOutputFormat(candidate.exportFileType)
  );
}

function isOutputFormat(value: unknown): value is OutputFormat {
  return value === OutputFormat.WAV || value === OutputFormat.MP3;
}
