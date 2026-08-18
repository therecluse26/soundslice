# 009 — Replace the store's ref and rerender hack

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [003 — Design the view state model](./003-design-the-view-state-model.md)
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can the store hold real reactive state instead of refs plus a forced redraw?

This is the third of the three known defects.

`src/stores/audio-store.ts` keeps everything in `MutableRefObject` wrappers.
Zustand cannot see writes to a ref, so nothing redraws. The workaround is
`triggerRerender: () => set({ rerender: Math.random() })` at line 86, called
from `src/pages/Dashboard.tsx:16`, where the comment reads "dumb hack to work
around updating above refs, but it works".

It works for Simple view, which has four settings. Advanced view has per-track
EQ, many regions, undo history, and per-track overrides. A random-number redraw
will not hold that, and it redraws every track when one changes.

The work:

1. Move `tracks`, `normalizeAudio`, `applyPostProcessing`, `trimSilence` and
   `exportFileType` into real store state.
2. Remove `rerender` and `triggerRerender`.
3. Make each `AudioEditor` subscribe only to its own track, so editing track
   three does not redraw track one. `AudioEditor` is already `React.memo`, but
   the current store defeats it.
4. Carry the view state model from ticket 003.

## Watch for

The `Region` object from wavesurfer is stored directly on `EditorTrack` at
`src/stores/audio-store.ts:8`. That is a live object owned by the wavesurfer
plugin, not plain data. Putting it in reactive state may cause loops or stale
reads. Store plain start and end numbers instead, and keep the plugin object out
of the store.

There is a known re-render sizing issue, fixed in commit `2027494`, and a
`requestAnimationFrame` resize loop at `src/components/custom/AudioEditor.tsx:113`
that runs every frame forever. Check whether fixing the store lets that loop be
replaced by a `ResizeObserver`.

## Acceptance

Redraw counts drop. Editing one track's settings redraws one card, not all of
them. Simple view behaves exactly as before.
