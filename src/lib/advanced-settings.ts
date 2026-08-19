import { EditorTrack } from "@/stores/audio-store";

/**
 * Counts the Advanced settings that Simple view cannot express.
 *
 * The rule, agreed in `.wayfinder/designs/view-state.md` section 3, is **one
 * each, in total**:
 *
 * - an operation Simple has no switch for counts one
 * - an operation Simple has, held at a non-default value, counts one
 * - more than one region anywhere counts **one**, not one per region
 * - an export choice Simple cannot offer counts one
 * - any per-track override of a master default counts **one**, not one per track
 *
 * Counting per item was rejected. A normal Advanced project would read
 * "37 Advanced settings active", which tells the user nothing.
 *
 * Today this can only ever return 0 or 1. Advanced view is an empty shell until
 * the feature tickets fill it, and there are no per-track overrides yet — every
 * track reads the same master settings. Each branch below names the ticket that
 * will make it reachable.
 */
export function countAdvancedSettings(tracks: EditorTrack[]): number {
  let count = 0;

  // More than one region on any track. One region per track is all that exists
  // today; many regions arrive with the Regions feature.
  if (tracks.some(hasExtraRegions)) count += 1;

  // Ticket 002 names the operation set, so non-default and Advanced-only
  // operations cannot be counted yet.
  // Ticket 009 adds per-track overrides, so those cannot be counted yet.
  // Ticket 011 adds FLAC, Opus, bit depth and sample rate, so an
  // Advanced-only export choice cannot be counted yet.

  return count;
}

/**
 * Regions on a track beyond the first.
 *
 * Simple view draws the first region by start time and exports only that one.
 * The rest are kept, not deleted, and return on switching back to Advanced.
 */
export function countHiddenRegions(track: EditorTrack): number {
  return Math.max(0, regionCount(track) - 1);
}

function hasExtraRegions(track: EditorTrack): boolean {
  return countHiddenRegions(track) > 0;
}

/**
 * `EditorTrack` still holds a single `selectedRegion`. Many regions per track
 * arrive with the Regions feature, and this is the one place that has to change
 * when they do.
 */
function regionCount(track: EditorTrack): number {
  return track.selectedRegion ? 1 : 0;
}
