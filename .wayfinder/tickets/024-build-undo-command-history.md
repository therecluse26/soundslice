# 024 — Build undo: the command history

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was [021 — Many regions per track](./021-many-regions-per-track.md), closed 2026-08-20

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

## Resolution — 2026-08-20

**Built.** [`history.ts`](../../src/lib/history.ts) is plain state — no store, no
React, no Web Audio — and the store is a thin shell over it. `dsp.ts`'s rule
applied to state rather than to maths, so the awkward part is testable in Node.

### The four things weighed

1. **Which gestures record.** Region create, move, resize, delete, rename, gain,
   fade, and split on silence. **Not** selecting — selecting changes no audio and
   no file, and an undo that only moved a highlight would look broken. **Not**
   master settings, adding a file, or an export. **Not** the default region a card
   writes on mount: the user did not do it, and the first Ctrl+Z of a session
   would otherwise delete a region nobody made. `ensureTrackRegions` is the silent
   path that makes that true.
2. **Redo: built.** The design does not mention it, and the reason to build it is
   that an entry already holds both halves — `before` is undo and `after` is redo
   — so it costs one array and no new state. Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y.
3. **Depth: 100 gestures.** Far past what anyone retraces by hand, and a hundred
   snapshots of six regions is a few kilobytes.
4. **Where it lives: a slice of the Zustand store.** One source of truth, which is
   ticket 009's whole point.
5. **The gesture boundary is real, and it is used.** `region-updated` fires when a
   drag ends and `region-update` does not, so a drag needs **no coalesce key at
   all** — two separate drags are two gestures and must undo separately. Coalescing
   is for the sliders, which have no end event of their own: they share a key
   while the mouse is down, and `onValueCommit` bumps a counter so the next drag
   of the same slider gets a different key.

`pushEntry` drops a gesture that changed nothing, and drops a coalesced gesture
that ends where it started — drag a region away and back and there is nothing to
undo to.

### The two "watch for" items

- **Ticket 009's rule.** History lives in the same `set` as the tracks, and only
  the changed track gets a new object. Measured: one edit on one card gave that
  card 4 renders and its list 2, and **the other card does not appear in the
  counts at all**.
- **Memory.** An entry holds region lists — numbers and short strings. Nothing
  here holds a `File`, an `AudioBuffer` or audio of any kind, so ticket 007's
  1 GB ceiling does not quietly gain a new counterparty. `snapshotTrack` copies
  the regions, so a later edit cannot rewrite the past, and a test proves it.

### Measured

- **Dragging a region edge across 200 pixels pushes one entry, not 200** —
  counted, not assumed: 200 one-pixel `pointermove` events, **1** history entry
  and **1** `region-updated`. The edge moved exactly 200 px, 3.0 s → 4.7418 s at
  114.82 px/s, and one Ctrl+Z put it back to **3.0** exactly.
- Undo after split on silence restores the previous region list **digit for
  digit**, and redo restores the split the same way.
- Ctrl+Z and Cmd+Z undo, and the screen moves to the card that changed —
  `undo()` returns the tracks the entry actually changed, compared rather than
  assumed, and the card carries `data-track-card` for the scroll.
- Undo never fights a text field: inside an `<input>`, `<textarea>` or a
  contenteditable, Ctrl+Z is the browser's undo for that text.
- `pnpm test` covers the history with 19 tests, in Node, with no browser.
