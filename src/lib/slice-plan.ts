/**
 * Planning an export: which files it writes, what each holds, and its name.
 *
 * Every output is planned before any of them renders. Two reasons, both in
 * ticket 023's acceptance:
 *
 * 1. **Progress counts outputs, not tracks.** Ten tracks of six regions is sixty
 *    renders, and a bar that counts ten sits at 10% for a long time.
 * 2. **Names are made unique against the whole export**, not against one track,
 *    so two tracks that each hold a region called "chorus" both arrive.
 *
 * It moved out of `audio-service.ts` in ticket 033, for one reason: that module
 * reaches the encode worker through a Vite `?worker` import, so Vitest cannot
 * load it. Planning is pure, and now that it decides three join modes and a
 * format per track it has earned its tests.
 */

import type { EditorTrack } from "@/stores/audio-store";
import type { ExportSettings } from "./audio-service";
import type { Region } from "./edit-stack";
import { outputFileName, regionFileName, uniqueFileName } from "./file-names";
import { FORMAT_EXTENSION } from "./output-format";
import {
  crossfadeInto,
  effectiveExportSettings,
  joinOrdered,
} from "./track-work";
import { orderedRegions } from "./edit-stack";

/** One track's share of one output file. */
export type SlicePart = {
  track: EditorTrack;

  /** The regions, in the order they play. One, or a track's whole join. */
  regions: Region[];

  /**
   * The crossfade into each region from the one before it, in milliseconds, by
   * index into `regions`. All zero is a butt join.
   */
  crossfadesMs: number[];
};

/** One file this export will write. */
export type SlicePlanItem = {
  /**
   * What the file holds, track by track.
   *
   * **One part** is every ordinary case — one region, or one track's join.
   * **Many** is a join across tracks: each part renders through its own
   * track's stack, and the parts are laid end to end afterwards.
   */
  parts: SlicePart[];

  /** Already unique, already sanitised. Ready for `zip.file`. */
  name: string;

  /**
   * The settings this file exports with: the master's, with its track's own
   * export overrides on top. A join across tracks writes one file, so it can
   * have only one format — it uses the master's, and ignores every override.
   */
  settings: ExportSettings;
};

/**
 * Plans every file this export will write.
 *
 * | `joinMode` | Files |
 * |---|---|
 * | `separate` (or absent) | one per region, numbered by start time |
 * | `track` | one per track, its regions in join order |
 * | `all` | one for the whole export, tracks in card order |
 *
 * A track with no regions contributes nothing. It is not an error and it is not
 * silent either: the caller can see the plan is shorter than the track list.
 */
export function planSlices(
  tracks: EditorTrack[],
  master: ExportSettings,
  taken = new Set<string>(),
  prefix = "sliced_"
): SlicePlanItem[] {
  const plan: SlicePlanItem[] = [];

  if (master.joinMode === "all") {
    const parts = tracks
      .map(joinedPart)
      .filter((part) => part.regions.length > 0);

    if (parts.length === 0) return plan;

    const extension = FORMAT_EXTENSION[master.exportFileType];
    const name =
      parts.length === 1
        ? outputFileName(parts[0].track.file.name, extension, prefix)
        : `${prefix}joined.${extension}`;

    plan.push({ parts, name: uniqueFileName(taken, name), settings: master });
    return plan;
  }

  for (const track of tracks) {
    const settings = effectiveExportSettings(master, track.exportOverrides);
    const extension = FORMAT_EXTENSION[settings.exportFileType];

    // Zero regions exports nothing. Skipping here rather than downstream is what
    // keeps `renderRegions`' own guard unreachable in practice.
    if (track.regions.length === 0) continue;

    // **Join: one item per track.** `outputFileName` gives a one-region track
    // the same name join gives it, so turning join on cannot rename a file that
    // was already alone.
    if (master.joinMode === "track") {
      plan.push({
        parts: [joinedPart(track)],
        name: uniqueFileName(
          taken,
          outputFileName(track.file.name, extension, prefix)
        ),
        settings,
      });
      continue;
    }

    const ordered = orderedRegions(track.regions);

    ordered.forEach((region, index) => {
      plan.push({
        parts: [{ track, regions: [region], crossfadesMs: [0] }],
        name: uniqueFileName(
          taken,
          regionFileName(
            track.file.name,
            extension,
            {
              name: region.name,
              number: index + 1,
              onlyRegion: ordered.length === 1,
            },
            prefix
          )
        ),
        settings,
      });
    });
  }

  return plan;
}

/** A track's whole join, in join order, with the crossfade at each seam. */
export function joinedPart(track: EditorTrack): SlicePart {
  const regions = joinOrdered(track.regions, track.join);

  return {
    track,
    regions,
    crossfadesMs: regions.map((region, index) =>
      index === 0 ? 0 : crossfadeInto(track.join, region.id)
    ),
  };
}

/** How many output files a plan writes. What the progress line counts. */
export function outputCount(plan: SlicePlanItem[]): number {
  return plan.length;
}
