# 024 — Build undo: the command history

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [021 — Many regions per track](./021-many-regions-per-track.md)
**Blocks:** [025 — Split on silence](./025-split-on-silence.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

The edit stack design specifies undo. Nothing implements it. Build it.

## Why now

**Split on silence replaces every region on a track.** It is the first truly
destructive gesture in the app, and there is nothing to reverse it with.

Grilling on 2026-08-20 weighed a confirmation dialog instead. Undo won: the
design is already written, so this is a build ticket and not a design one, and
every later feature needs it.

Checked before writing this ticket: `src/` holds no `undo`, no `redo` and no
command history of any kind.

## Already decided, and not reopened

[`designs/edit-stack.md`](../designs/edit-stack.md) §8:

- **A command history. One entry per gesture, not per value change.**
- Entries **coalesce while the mouse is down**.
- **One history for the whole project**, not one per track. "Clear Advanced
  settings" touches every track at once, and per-track history cannot express it.
- **Undo scrolls to what it changed**, because one history can act on a card that
  is off screen.
- An entry records what changed and how to put it back. It is not "pop the last
  operation" — editing an EQ band is an edit, not an addition.

## What to weigh

1. **Which gestures record.** Region create, move, resize, delete, rename, gain,
   fade. Do master settings? Does adding a file? Does an export?
2. **Redo.** The design does not mention it. Decide, and record why.
3. **Depth.** An unbounded history holds every region list the session ever had.
   Bounded is cheaper and forgets. Name the number.
4. **Where it lives.** A slice of the Zustand store, or a store of its own? A
   slice keeps one source of truth, which is ticket 009's whole point.
5. **The gesture boundary is available.** wavesurfer fires `region-update`
   *during* a drag and `region-updated` *when it ends*; a region also fires
   `update` and `update-end`. Coalescing has a real event to close on, so it does
   not need a timer.

## Watch for

- **Ticket 009's rule.** The store holds real state, and nothing is forced to
  redraw. A history that lives in the store must not make every card render on
  every gesture.
- **Memory.** A history entry holds region lists, which are numbers, not audio.
  Say so, and then check it — ticket 007's 1 GB ceiling counts what is loaded,
  and this must not quietly join it.

## Acceptance

- Ctrl+Z and Cmd+Z undo the last gesture, and the screen moves to the card that
  changed.
- **Dragging a region edge across 200 pixels pushes one entry, not 200** —
  counted, not assumed.
- Undo after a destructive gesture restores the previous region list **digit for
  digit**.
- Undo across two tracks replays in the order the gestures happened.
- `pnpm test` covers the history. It is plain state, so it needs no browser —
  `dsp.ts`'s rule applied to the store.
