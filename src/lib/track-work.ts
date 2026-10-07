/**
 * A track's **work** — everything on a track that the user made.
 *
 * A track is a file plus the work done on it. The file is the browser's and the
 * work is ours: regions, the edit stack, the export choices this track overrides,
 * and how a join lays its regions out. Three things read this one shape and must
 * agree about it:
 *
 * | Reader | Why it needs the whole of it |
 * |---|---|
 * | the command history | undo puts the work back, all of it, or a region drag throws an EQ away |
 * | saved projects | a project **is** the work, with the audio left out |
 * | "Copy to all tracks" | it copies part of the work and has to know which part |
 *
 * So the shape lives here, once. Before this file the history snapshot named
 * three fields by hand, and every field added to a track was a field undo
 * quietly forgot.
 *
 * Plain types and plain functions. No store, no React, no Web Audio — `dsp.ts`'s
 * rule, so Vitest reads it under Node.
 */

import type { ExportSettings } from "./audio-service";
import type { EditStack, Region } from "./edit-stack";
import { orderedRegions } from "./edit-stack";
import type { BitDepth, OutputFormat } from "./output-format";

/**
 * The export choices one track makes for itself. Absent means **inherited**.
 *
 * Ticket 003's override model, applied to the three export choices: a track
 * holds a *partial* of the master settings, never a copy, so changing the
 * master changes every track that has not said otherwise.
 *
 * `outputSampleRate: null` is a real override — "this track keeps its own rate"
 * while the master asks for 48 kHz — so it is not the same as the key being
 * absent.
 */
export type ExportOverrides = {
  exportFileType?: OutputFormat;
  bitDepth?: BitDepth;
  outputSampleRate?: number | null;
};

/**
 * How a **join** lays this track's regions end to end.
 *
 * Both parts are optional, and absent is today's join exactly: start-time order
 * and a butt join at every seam.
 */
export type JoinLayout = {
  /**
   * Region ids, in the order the join plays them, once the user has reordered
   * them on the join strip.
   *
   * A list of ids and not an order field on each region, because the order is a
   * fact about the join, not about any one region — and a region that is deleted
   * must not leave a hole that every other region has to be renumbered around.
   */
  order?: string[];

  /**
   * The crossfade **into** a region from the one before it, in milliseconds, by
   * that region's id.
   *
   * Keyed on the region that comes *after* the seam, so a crossfade travels with
   * the region when the join is reordered. Absent or 0 is a butt join.
   */
  crossfadeMs?: Record<string, number>;
};

/** Everything on a track that the user made. The file itself is not work. */
export type TrackWork = {
  regions: Region[];
  selectedRegionId?: string;
  stack?: EditStack;
  exportOverrides?: ExportOverrides;
  join?: JoinLayout;
};

/** A copy of the work that shares no object with the original. */
export function copyWork(work: TrackWork): TrackWork {
  return {
    regions: work.regions.map((region) => ({
      ...region,
      fade: { ...region.fade },
      stretch: region.stretch ? { ...region.stretch } : undefined,
    })),
    selectedRegionId: work.selectedRegionId,
    // A noise profile is immutable and carries its own id, so it is shared, not
    // copied. Copying 1025 floats on every gesture buys nothing.
    stack: work.stack?.map((operation) =>
      operation.op === "eq"
        ? { ...operation, bands: operation.bands.map((band) => ({ ...band })) }
        : { ...operation }
    ),
    exportOverrides: work.exportOverrides
      ? { ...work.exportOverrides }
      : undefined,
    join: work.join
      ? {
          order: work.join.order ? [...work.join.order] : undefined,
          crossfadeMs: work.join.crossfadeMs
            ? { ...work.join.crossfadeMs }
            : undefined,
        }
      : undefined,
  };
}

/** True when a track overrides at least one master export choice. */
export function hasExportOverrides(overrides: ExportOverrides | undefined): boolean {
  return !!overrides && Object.keys(overrides).some(
    (key) => overrides[key as keyof ExportOverrides] !== undefined
  );
}

/**
 * The export settings one track exports with: the master's, with this track's
 * overrides laid on top.
 *
 * `outputSampleRate` changes shape on the way through, exactly as
 * `masterExportSettings` changes it: the override says `null` for "the file's
 * own rate", because `localStorage` cannot hold `undefined`, and the engine
 * reads `undefined` for the same thing.
 */
export function effectiveExportSettings(
  master: ExportSettings,
  overrides: ExportOverrides | undefined
): ExportSettings {
  if (!overrides) return master;

  return {
    ...master,
    exportFileType: overrides.exportFileType ?? master.exportFileType,
    bitDepth: overrides.bitDepth ?? master.bitDepth,
    outputSampleRate:
      overrides.outputSampleRate === undefined
        ? master.outputSampleRate
        : overrides.outputSampleRate ?? undefined,
  };
}

/**
 * The regions in the order a join plays them.
 *
 * Start-time order unless the user has reordered them. A region made after the
 * reorder is not in the stored list; it joins at the end, in start-time order
 * among the other newcomers, so adding a region never shuffles the ones the user
 * already placed. An id in the list whose region is gone is skipped.
 */
export function joinOrdered(
  regions: readonly Region[],
  layout: JoinLayout | undefined
): Region[] {
  const byStart = orderedRegions(regions);
  const order = layout?.order;
  if (!order || order.length === 0) return byStart;

  const byId = new Map(regions.map((region) => [region.id, region]));
  const placed: Region[] = [];
  const seen = new Set<string>();

  for (const id of order) {
    const region = byId.get(id);
    if (!region || seen.has(id)) continue;
    placed.push(region);
    seen.add(id);
  }

  for (const region of byStart) {
    if (!seen.has(region.id)) placed.push(region);
  }

  return placed;
}

/** True when the join plays the regions in an order other than start time. */
export function isJoinReordered(
  regions: readonly Region[],
  layout: JoinLayout | undefined
): boolean {
  const joined = joinOrdered(regions, layout);
  return orderedRegions(regions).some((region, index) => region !== joined[index]);
}

/** The crossfade into this region from the one before it. 0 is a butt join. */
export function crossfadeInto(
  layout: JoinLayout | undefined,
  regionId: string
): number {
  const ms = layout?.crossfadeMs?.[regionId];
  return ms !== undefined && Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** True when any seam of this join crossfades. */
export function hasCrossfades(layout: JoinLayout | undefined): boolean {
  return Object.values(layout?.crossfadeMs ?? {}).some((ms) => ms > 0);
}
