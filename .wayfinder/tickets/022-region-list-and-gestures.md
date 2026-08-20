# 022 — The region list and its gestures

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [021 — Many regions per track](./021-many-regions-per-track.md)
**Blocks:** [025 — Split on silence](./025-split-on-silence.md),
[026 — Snap to transients](./026-snap-to-transients.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

Where does a user see six regions, and how do they make, select, rename, resize
and delete them?

## Decided in grilling, 2026-08-20

| Decision | Answer |
|---|---|
| Where the list lives | **on the track card, under the waveform** |
| The Advanced panel's Regions section | holds the **tools**, not the list |
| Create | drag on empty waveform, **or** an **Add region** button in the list |
| Move and resize | drag inside a region |
| Delete | an X on the list row, and the Delete key on the selected region |
| Select | click the region, or its row |
| Rename | optional name, edited in the list row |
| Per-region controls | **gain in dB, fade in, fade out** — on the selected row |

**Why the card and not the panel.** A region list belongs to one track, and the
card owns one track. A master panel holding a per-track list must first answer
"which track?", and there is no answer to that today.

## Facts already checked

Read from `node_modules/wavesurfer.js/dist/plugins/regions.d.ts`:

- `RegionsPlugin.enableDragSelection(options, threshold?)` exists and **returns
  an unsubscribe function**. It is what makes drag-to-create work.
- **Dragging inside an existing region moves it**, because the region's own
  element sits on top. Create and move do not fight, so overlap stays reachable.
- `RegionParams` carries `id`, `content` and `contentEditable`, so a name can
  render on the region itself and be edited there.
- The plugin fires `region-created`, `region-update` (**during** a drag, with
  the side), `region-updated` (**when the drag ends**), `region-removed`,
  `region-clicked` and `region-double-clicked`.
- A region fires `update`, `update-end`, `remove`, `play`, `click` and
  `dblclick`.

## What to weigh

1. **Where the name shows.** On the region as `content`, in the list row, or
   both. `contentEditable` makes in-place renaming free.
2. **Six rows under a waveform is tall.** Does the list scroll, collapse, or show
   only the selected row expanded?
3. **Region gain stacks with the track's stack** — it does not replace it
   ([`designs/edit-stack.md`](../designs/edit-stack.md) §4). Changing it must
   reach preview through `PreviewGraph.update`, or the user hears nothing move.
4. **`defaultRegion` gives 20 ms fades.** A control that reaches 0 ms lets a user
   make a pop. Decide whether 0 is allowed, and say why.

## Watch for

- **Ticket 020's rule.** Every listener added is collected and removed by name.
  `wavesurfer.unAll()` is not to come back — it removed preview's listeners too,
  silently.
- **Preview follows the selected region.** Changing the selection during playback
  must reschedule the envelope or stop. `scheduleRegionEnvelope` writes one
  envelope for one region.
- **Ticket 009's rule.** A card subscribes to its own track. A region list must
  not make every other card redraw.

## Acceptance

- Drag on empty waveform creates a region. Drag inside one moves it. Both write
  to the store.
- Six regions each rename, resize and delete, and every change survives a
  remount.
- The selected region's gain and fades change what preview plays, **proved by
  measurement, not by ear** — the method ticket 019 used.
- **A playing card still renders zero times**, ticket 020's figure.
- No wavesurfer instance is rebuilt by any of it — counted, as ticket 020 counted
  it.
