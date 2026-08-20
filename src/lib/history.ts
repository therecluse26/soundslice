/**
 * Undo — the command history the edit stack design specified and nothing built.
 *
 * [`designs/edit-stack.md`](../../.wayfinder/designs/edit-stack.md) §8 settled
 * the shape and this file does not reopen it:
 *
 * - **One entry per gesture, not per value change.** Dragging a region edge
 *   across 200 pixels is one entry.
 * - **Entries coalesce while the mouse is down**, by `coalesceKey`.
 * - **One history for the whole project**, not one per track. A gesture that
 *   touches every track at once cannot be expressed by per-track histories.
 * - **An entry records what changed and how to put it back.** It is not "pop the
 *   last operation": editing a value is an edit, not an addition.
 *
 * ## Plain state, so a Node test can drive it
 *
 * No store, no React, no Web Audio. `dsp.ts`'s rule applied to state rather than
 * to maths: the store calls these functions and holds what they return, so the
 * awkward part is testable without a browser and the store stays a thin shell.
 *
 * ## What an entry holds, and what it costs
 *
 * A snapshot of the **regions** of every track the gesture touched, before and
 * after. Regions are numbers and short strings; nothing here holds audio, a
 * `File`, or an `AudioBuffer`. Ticket 007's 1 GB ceiling counts loaded files and
 * this must never quietly join them — so a region snapshot is a plain object
 * copy and stops there.
 */

import { Region } from "./edit-stack";

/** One track's regions and its selection, at one moment. */
export type TrackSnapshot = {
  fileName: string;
  regions: Region[];
  selectedRegionId?: string;
};

/** One gesture, and how to put it back. */
export type HistoryEntry = {
  /** What the user did, in their words. Shown on the undo control. */
  label: string;
  before: TrackSnapshot[];
  after: TrackSnapshot[];

  /**
   * Two pushes sharing this key are one gesture.
   *
   * wavesurfer gives a real gesture boundary — `region-update` fires during a
   * drag and `region-updated` when it ends — so the store could record only on
   * the end event. It does not rely on that alone: a slider has its own commit
   * event, a keyboard repeat has none, and a key that names the region and the
   * property coalesces all three without a timer.
   */
  coalesceKey?: string;
};

export type History = {
  /** Oldest first. The last entry is the next to undo. */
  past: HistoryEntry[];
  /** Oldest first. The last entry is the next to redo. */
  future: HistoryEntry[];
};

export const EMPTY_HISTORY: History = { past: [], future: [] };

/**
 * How many gestures are remembered.
 *
 * Bounded, because an unbounded history holds every region list the session ever
 * had and the design's own "watch for" asks the number to be named. A hundred
 * gestures is far past what anyone retraces by hand, and a hundred snapshots of
 * six regions is a few kilobytes.
 */
export const HISTORY_DEPTH = 100;

/** A copy of a track's regions that shares nothing with the live ones. */
export function snapshotTrack(
  fileName: string,
  regions: readonly Region[],
  selectedRegionId?: string
): TrackSnapshot {
  return {
    fileName,
    regions: regions.map((region) => ({
      ...region,
      fade: { ...region.fade },
      stretch: region.stretch ? { ...region.stretch } : undefined,
    })),
    selectedRegionId,
  };
}

/** True when these two snapshots describe the same regions in the same order. */
export function snapshotsEqual(a: TrackSnapshot[], b: TrackSnapshot[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Records a gesture.
 *
 * Three rules, in order:
 *
 * 1. **A gesture that changed nothing is not recorded.** Clicking a region
 *    writes its bounds back unchanged; an undo stack full of those would make
 *    Ctrl+Z look broken.
 * 2. **A matching `coalesceKey` extends the entry already on top** — its
 *    `before` is kept, so undo returns to where the gesture started, not to the
 *    last frame of it.
 * 3. **Any new gesture clears the future.** Editing after an undo abandons the
 *    branch that was undone, which is what every editor does.
 */
export function pushEntry(history: History, entry: HistoryEntry): History {
  if (snapshotsEqual(entry.before, entry.after)) return history;

  const top = history.past[history.past.length - 1];

  if (entry.coalesceKey && top && top.coalesceKey === entry.coalesceKey) {
    const merged: HistoryEntry = {
      label: entry.label,
      before: top.before,
      after: entry.after,
      coalesceKey: entry.coalesceKey,
    };

    // The merge can cancel the whole gesture out — drag a region away and back
    // and it ends where it started. Drop it rather than leave an entry that
    // undoes to the same picture.
    const past = history.past.slice(0, -1);
    if (!snapshotsEqual(merged.before, merged.after)) past.push(merged);

    return { past, future: [] };
  }

  const past = [...history.past, entry];
  if (past.length > HISTORY_DEPTH) past.splice(0, past.length - HISTORY_DEPTH);

  return { past, future: [] };
}

/**
 * The gesture to reverse, and the history without it.
 *
 * `entry` is `null` when there is nothing to undo. The caller applies
 * `entry.before`.
 */
export function undoEntry(history: History): {
  history: History;
  entry: HistoryEntry | null;
} {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { history, entry: null };

  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, entry] },
    entry,
  };
}

/**
 * The gesture to replay, and the history with it back.
 *
 * The design does not mention redo. It is built anyway, and the reason is that
 * an entry already holds both halves: `before` is undo and `after` is redo, so
 * redo costs one array and no new state. Leaving it out would make an accidental
 * Ctrl+Z destroy work that is still in memory.
 */
export function redoEntry(history: History): {
  history: History;
  entry: HistoryEntry | null;
} {
  const entry = history.future[history.future.length - 1];
  if (!entry) return { history, entry: null };

  return {
    history: { past: [...history.past, entry], future: history.future.slice(0, -1) },
    entry,
  };
}

/**
 * The tracks this entry actually changed.
 *
 * Undo scrolls to what it changed, because one history can act on a card that is
 * off screen. An entry may snapshot a track it left alone — the store snapshots
 * whatever the gesture named — so the answer is compared, not assumed.
 */
export function changedFileNames(entry: HistoryEntry): string[] {
  const after = new Map(entry.after.map((snap) => [snap.fileName, snap]));

  return entry.before
    .filter((snap) => JSON.stringify(after.get(snap.fileName)) !== JSON.stringify(snap))
    .map((snap) => snap.fileName);
}
