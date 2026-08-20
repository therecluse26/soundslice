import { EditorTrack } from "@/stores/audio-store";
import {
  DEFAULT_BIT_DEPTH,
  OutputFormat,
  SIMPLE_FORMATS,
} from "./output-format";

/**
 * The three export choices Advanced view adds, as Simple view sees them.
 *
 * Simple view has one control here, **Output Format**, and it offers WAV and
 * MP3. A depth other than 16 bits, a rate other than the file's own, or a format
 * outside those two is a choice Simple cannot express.
 */
export type ExportChoice = {
  exportFileType: OutputFormat;
  bitDepth: number;
  outputSampleRate: number | null;
};

/** True when this export cannot be described by Simple view's one select. */
export function isAdvancedExportChoice(choice: ExportChoice): boolean {
  return (
    !SIMPLE_FORMATS.some((format) => format === choice.exportFileType) ||
    choice.bitDepth !== DEFAULT_BIT_DEPTH ||
    choice.outputSampleRate !== null
  );
}

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
 * Today this can only ever return 0, 1 or 2. Advanced view's Sound and Regions
 * sections are still empty, and there are no per-track overrides yet — every
 * track reads the same master settings. Each branch below names the ticket that
 * will make it reachable.
 */
export function countAdvancedSettings(
  tracks: EditorTrack[],
  exportChoice: ExportChoice
): number {
  let count = 0;

  // More than one region on any track. Reachable since ticket 021.
  if (tracks.some(hasExtraRegions)) count += 1;

  // FLAC, Opus, 24-bit, or a sample rate that is not the file's own. **One in
  // total**, not one per choice: three of them still read "1 Advanced setting
  // active", because they are all the same sentence — "this export is not one
  // Simple view could describe".
  if (isAdvancedExportChoice(exportChoice)) count += 1;

  // Ticket 002 names the operation set, so non-default and Advanced-only
  // operations cannot be counted yet.
  // Ticket 009 adds per-track overrides, so those cannot be counted yet.

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
 * How many regions this track holds.
 *
 * It used to read `track.region ? 1 : 0`, because a track held one. Ticket 021
 * gave it many, and the chip's count kept its meaning without changing: **more
 * than one region anywhere counts one**, not one per region. A user with six
 * regions on ten tracks still reads "1 Advanced setting active", because it is
 * still one sentence — "this export is not one Simple view could describe".
 */
function regionCount(track: EditorTrack): number {
  return track.regions.length;
}
