/**
 * Editing a join's layout: the join strip's moves. Ticket 034.
 *
 * Apart from `track-work.ts` because only the join strip edits a layout, and
 * the strip is Advanced-only. `track-work.ts` is read by the export path in
 * every bundle; these are not. Standing rule 6.
 */

import type { Region } from "./edit-stack";
import { JoinLayout, joinOrdered } from "./track-work";

/**
 * The join with one region moved one place earlier (`-1`) or later (`1`).
 *
 * The whole order is written down on the first move, so a region made later
 * joins at the end instead of shuffling the ones the user placed. Moving past
 * either end changes nothing and returns the same layout.
 */
export function shiftInJoin(
  regions: readonly Region[],
  layout: JoinLayout | undefined,
  regionId: string,
  delta: -1 | 1
): JoinLayout | undefined {
  const order = joinOrdered(regions, layout).map((region) => region.id);
  const from = order.indexOf(regionId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return layout;

  [order[from], order[to]] = [order[to], order[from]];
  return tidyJoin({ ...layout, order });
}

/** The join with one region moved to stand where another stood. */
export function moveInJoin(
  regions: readonly Region[],
  layout: JoinLayout | undefined,
  regionId: string,
  targetId: string
): JoinLayout | undefined {
  const order = joinOrdered(regions, layout).map((region) => region.id);
  const from = order.indexOf(regionId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return layout;

  order.splice(from, 1);
  order.splice(to, 0, regionId);
  return tidyJoin({ ...layout, order });
}

/** The join with the crossfade into one region set. 0 removes it. */
export function withCrossfade(
  layout: JoinLayout | undefined,
  regionId: string,
  ms: number
): JoinLayout | undefined {
  const crossfadeMs = { ...layout?.crossfadeMs };
  if (Number.isFinite(ms) && ms > 0) crossfadeMs[regionId] = Math.round(ms);
  else delete crossfadeMs[regionId];

  return tidyJoin({ ...layout, crossfadeMs });
}

/**
 * The join back to start-time order, keeping its crossfades.
 *
 * What the join strip's "Reset order" does. The crossfades travel with their
 * regions, so they survive.
 */
export function withStartTimeOrder(
  layout: JoinLayout | undefined
): JoinLayout | undefined {
  return tidyJoin({ ...layout, order: undefined });
}

/**
 * A layout with nothing in it is no layout at all.
 *
 * `{}` and `undefined` mean the same join, and the history must not see a
 * change between them.
 */
export function tidyJoin(layout: JoinLayout | undefined): JoinLayout | undefined {
  if (!layout) return undefined;

  const order = layout.order && layout.order.length > 0 ? layout.order : undefined;
  const crossfadeMs =
    layout.crossfadeMs && Object.keys(layout.crossfadeMs).length > 0
      ? layout.crossfadeMs
      : undefined;

  if (!order && !crossfadeMs) return undefined;

  const tidy: JoinLayout = {};
  if (order) tidy.order = order;
  if (crossfadeMs) tidy.crossfadeMs = crossfadeMs;
  return tidy;
}
