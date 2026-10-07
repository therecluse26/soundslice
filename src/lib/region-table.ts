/**
 * The rows of Advanced view's **region table**: one per region, in the order
 * that matters right now.
 *
 * With join off the order is start time, the order the region numbers already
 * show. **With join on, the table is the join order** — the join strip it
 * replaced held exactly this list — so a row's position is where its audio
 * plays in the joined file, and each row after the first carries the crossfade
 * into it.
 *
 * Pure, so the table component only draws.
 */

import { Region, isStretched, orderedRegions, regionLabel, regionNumber } from "./edit-stack";
import { JoinLayout, crossfadeInto, joinOrdered } from "./track-work";

export type RegionRow = {
  region: Region;
  /** The region's number by start time — its tag on the waveform. */
  number: number;
  label: string;
  /** Where it plays, from 1. Start-time order when join is off. */
  position: number;
  /** The crossfade into this region. `null` for the first, which has no seam. */
  crossfadeMs: number | null;
};

export function regionRows(
  regions: readonly Region[],
  layout: JoinLayout | undefined,
  joining: boolean
): RegionRow[] {
  const ordered = joining ? joinOrdered(regions, layout) : orderedRegions(regions);

  return ordered.map((region, index) => ({
    region,
    number: regionNumber(regions, region.id),
    label: regionLabel(regions, region),
    position: index + 1,
    crossfadeMs: index === 0 ? null : crossfadeInto(layout, region.id),
  }));
}

/** `m:ss.cc` — a time to the hundredth, the precision a region edge has. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = (safe - minutes * 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${rest}`;
}

/** `+2.0 dB`, `0.0 dB`, `−3.5 dB` — with a real minus sign. */
export function formatGain(db: number): string {
  if (Math.abs(db) < 0.05) return "0.0 dB";
  const text = Math.abs(db).toFixed(1);
  return db > 0 ? `+${text} dB` : `−${text} dB`;
}

/** `20 / 20 ms`: fade in, then fade out. */
export function formatFades(region: Region): string {
  return `${Math.round(region.fade.inMs)} / ${Math.round(region.fade.outMs)} ms`;
}

/** `1.10× · −1 st`, or `—` for a region at its own speed and pitch. */
export function formatStretch(region: Region): string {
  if (!isStretched(region) || !region.stretch) return "—";
  const { rate, semitones } = region.stretch;
  const parts: string[] = [];
  if (rate !== 1) parts.push(`${rate.toFixed(2)}×`);
  if (semitones !== 0) {
    const st = Math.abs(semitones);
    parts.push(`${semitones > 0 ? "+" : "−"}${Number.isInteger(st) ? st : st.toFixed(1)} st`);
  }
  return parts.join(" · ");
}
