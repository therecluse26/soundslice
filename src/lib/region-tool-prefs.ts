/**
 * How the region tools are set, kept across a reload.
 *
 * ## A preference, not project work
 *
 * The map left this open: `snapToTransients` and split on silence's three
 * numbers survived a view switch and not a reload, and *"whether a working mode
 * should persist at all is a decision nobody has made"*. Ticket 032 made it.
 *
 * **They persist, beside the view and not inside a project.** A user who tuned
 * split on silence for their microphone wants those numbers again tomorrow, on a
 * different file. They describe how this person works, the way the view does —
 * not what any one export is made of, which is what `MasterDefaults` holds and
 * what a saved project carries. So they get their own key, and a saved project
 * neither stores nor restores them.
 *
 * ## Why the guard is structural
 *
 * The store reads this at start-up, so this module is in every bundle. The
 * defaults and the ranges live in `silence.ts` and `transient-split.ts`, which
 * only Advanced view downloads — standing rule 6. So the guard here checks
 * shape and finiteness only, and each tool clamps to its own ranges when it
 * reads the numbers, which split on silence already did.
 */

import type { SilenceSettings } from "./silence";

/** Split at transients: one region per attack. See `transient-split.ts`. */
export type TransientSplitSettings = {
  /** Two attacks closer than this make one region. In milliseconds. */
  minRegionMs: number;
  /** How far before each attack its region starts. In milliseconds. */
  leadInMs: number;
};

export type RegionToolPrefs = {
  snapToTransients: boolean;
  /** `null` is the tool's own defaults. */
  silenceSettings: SilenceSettings | null;
  /** `null` is the tool's own defaults. */
  transientSplitSettings: TransientSplitSettings | null;
};

export const REGION_TOOLS_STORAGE_KEY = "region-tools";
export const REGION_TOOLS_STORAGE_VERSION = 1;

export const DEFAULT_REGION_TOOL_PREFS: RegionToolPrefs = {
  snapToTransients: false,
  silenceSettings: null,
  transientSplitSettings: null,
};

export function isRegionToolPrefs(value: unknown): value is RegionToolPrefs {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.snapToTransients === "boolean" &&
    (candidate.silenceSettings === null ||
      hasFiniteNumbers(candidate.silenceSettings, [
        "thresholdDb",
        "minSilenceMs",
        "paddingMs",
      ])) &&
    (candidate.transientSplitSettings === null ||
      hasFiniteNumbers(candidate.transientSplitSettings, [
        "minRegionMs",
        "leadInMs",
      ]))
  );
}

function hasFiniteNumbers(value: unknown, keys: string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.every(
    (key) => typeof record[key] === "number" && Number.isFinite(record[key])
  );
}
