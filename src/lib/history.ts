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
 * A snapshot of the **work** of every track the gesture touched, before and
 * after — see [`track-work.ts`](./track-work.ts). Work is numbers and short
 * strings; it holds no audio and no `AudioBuffer`.
 *
 * Since ticket 030 an entry may also hold two more things, and only when the
 * gesture changed them:
 *
 * | Part | Gesture |
 * |---|---|
 * | `master` | changing a master default — a switch, the format, the target |
 * | `files` | adding files, or removing a track |
 *
 * **`files` holds real `File` objects.** A removed track has to come back with
 * its audio, and the browser cannot re-open a file for us. So an undo entry for
 * "Remove track" keeps that file alive, and ticket 007's 1 GB ceiling counts it —
 * `filesHeldByHistory` is how the store finds them. Nothing is evicted behind
 * the user's back; the history depth is the only thing that ever lets one go.
 */

import type { EditStack, Region } from "./edit-stack";
import type { MasterDefaults } from "./master-defaults";
import { TrackWork, copyWork } from "./track-work";

/**
 * One track's regions, its selection and its stack, at one moment.
 *
 * **The stack is in the snapshot, and every snapshot carries it.** A snapshot
 * that held only regions would be a partial write: the store applies whatever
 * the snapshot names, so a region gesture would put the stack back to
 * `undefined` and an EQ would vanish on the next drag.
 *
 * `undefined` is a real value here — it means the track inherits the master
 * defaults — so it round-trips like any other.
 */
export type TrackSnapshot = { fileName: string } & TrackWork;

/** Two halves of one change: how it was, and how the gesture left it. */
export type Change<T> = { before: T; after: T };

/** One gesture, and how to put it back. */
export type HistoryEntry = {
  /** What the user did, in their words. Shown on the undo control. */
  label: string;
  before: TrackSnapshot[];
  after: TrackSnapshot[];

  /** The master defaults, when the gesture changed one. */
  master?: Change<MasterDefaults>;

  /**
   * The track list, in order, when the gesture added or removed a track.
   *
   * Applying `before` puts back exactly these files in exactly this order. A
   * file that is in the list and not on screen is made a track again, with the
   * work its `TrackSnapshot` in this entry holds.
   */
  files?: Change<File[]>;

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

/**
 * A copy of a track's editable state that shares nothing with the live one.
 *
 * Deep enough that undoing cannot be undone by a later edit writing through a
 * shared object. Two levels matter: a region's `fade`, and an EQ's `bands`.
 * Neither holds audio — the whole snapshot is numbers and short strings, and
 * ticket 007's 1 GB ceiling must never start counting this.
 */
export function snapshotTrack(
  fileName: string,
  regions: readonly Region[],
  selectedRegionId?: string,
  stack?: EditStack
): TrackSnapshot {
  return snapshotWork(fileName, {
    regions: [...regions],
    selectedRegionId,
    stack,
  });
}

/** A copy of one track's whole work, ready to go on the history. */
export function snapshotWork(fileName: string, work: TrackWork): TrackSnapshot {
  return { fileName, ...copyWork(work) };
}

/** True when these two snapshots describe the same state in the same order. */
export function snapshotsEqual(a: TrackSnapshot[], b: TrackSnapshot[]): boolean {
  return stableJson(a) === stableJson(b);
}

/** True when this entry changes nothing at all, in any of its parts. */
function changesNothing(entry: HistoryEntry): boolean {
  return (
    snapshotsEqual(entry.before, entry.after) &&
    (!entry.master || stableJson(entry.master.before) === stableJson(entry.master.after)) &&
    (!entry.files || sameFiles(entry.files.before, entry.files.after))
  );
}

/** The same files in the same order. Compared by object, not by name. */
function sameFiles(a: File[], b: File[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

/**
 * Every file the history keeps alive, that is not in `onScreen`.
 *
 * A removed track's file stays reachable from its undo entry. It costs the same
 * memory as a track on screen, so the memory ceiling has to count it — or ten
 * removed 476 MB tracks would sit in the history and the ceiling would think
 * the page held nothing.
 */
export function filesHeldByHistory(history: History, onScreen: File[]): File[] {
  const held = new Set<File>();

  for (const entry of [...history.past, ...history.future]) {
    for (const file of [...(entry.files?.before ?? []), ...(entry.files?.after ?? [])]) {
      if (!onScreen.includes(file)) held.add(file);
    }
  }

  return [...held];
}

/**
 * A snapshot as a string that can be compared, **without serialising audio**.
 *
 * A noise profile holds a `Float32Array` of magnitudes. `JSON.stringify` turns
 * one of those into an object with a numbered key per bin — thousands of them,
 * on every push, twice. A profile is immutable and already carries an `id`, so
 * the id is the whole of its identity and that is what is compared.
 *
 * Every noise reduction block on a track's stack reaches this branch on every
 * gesture on that track, so the comparison stays cheap however many bins a
 * profile holds.
 */
function stableJson(snapshots: unknown): string {
  return JSON.stringify(snapshots, (key, value) =>
    key === "profile" && value && typeof value === "object" && "id" in value
      ? value.id
      : value
  );
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
  if (changesNothing(entry)) return history;

  const top = history.past[history.past.length - 1];

  if (entry.coalesceKey && top && top.coalesceKey === entry.coalesceKey) {
    const merged: HistoryEntry = {
      label: entry.label,
      before: top.before,
      after: entry.after,
      coalesceKey: entry.coalesceKey,
    };

    // Each part keeps the start of the gesture and takes the end of it, the
    // same way the track snapshots do.
    const master = mergeChange(top.master, entry.master);
    if (master) merged.master = master;
    const files = mergeChange(top.files, entry.files);
    if (files) merged.files = files;

    // The merge can cancel the whole gesture out — drag a region away and back
    // and it ends where it started. Drop it rather than leave an entry that
    // undoes to the same picture.
    const past = history.past.slice(0, -1);
    if (!changesNothing(merged)) past.push(merged);

    return { past, future: [] };
  }

  const past = [...history.past, entry];
  if (past.length > HISTORY_DEPTH) past.splice(0, past.length - HISTORY_DEPTH);

  return { past, future: [] };
}

function mergeChange<T>(
  first: Change<T> | undefined,
  next: Change<T> | undefined
): Change<T> | undefined {
  if (!first) return next;
  if (!next) return first;
  return { before: first.before, after: next.after };
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
    .filter((snap) => {
      const other = after.get(snap.fileName);
      return !other || !snapshotsEqual([snap], [other]);
    })
    .map((snap) => snap.fileName);
}

/**
 * What undo would reverse, in the user's words, or `null` for nothing.
 *
 * The header's undo button shows it, so a user can see what the next press
 * does before pressing it. One history serves the whole project, so the thing
 * it undoes may be on a card that is off screen.
 */
export function nextUndoLabel(history: History): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

/** What redo would replay, or `null` for nothing. */
export function nextRedoLabel(history: History): string | null {
  return history.future[history.future.length - 1]?.label ?? null;
}
