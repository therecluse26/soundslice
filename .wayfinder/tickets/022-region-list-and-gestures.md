# 022 — The region list and its gestures

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was [021 — Many regions per track](./021-many-regions-per-track.md), closed 2026-08-20

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

## Resolution — 2026-08-20

**Built.** The list is on the card, under the waveform, in Advanced view only.
The Advanced panel's Regions section holds the tools.

### What a user can do

| Gesture | How |
|---|---|
| Create | drag on empty waveform, or the **Add region** button |
| Move and resize | drag inside a region, or its edge handles |
| Select | click the region, or its row |
| Rename | type in the row. The name shows on the waveform too |
| Delete | the X on the row, or the Delete key on the selected region |
| Gain, fade in, fade out | sliders on the selected row |

### The four things weighed

1. **Where the name shows: both.** The row holds the input; the region carries
   the same string as `content`. `contentEditable` was **not** used — one input,
   in one place, and no second editing surface to keep in step.
2. **Six rows is tall.** The list scrolls past four rows, and only the selected
   row opens its three sliders.
3. **Region gain reaches preview.** It did not, at first — see the defect below.
4. **0 ms fade is allowed**, and the row says what it costs: "A 0 ms fade is a
   hard cut, and a hard cut can pop." A region cut at a zero crossing needs no
   ramp, and forbidding 0 would make a hard cut impossible.

### One defect found by measuring, not by reading

**A region's gain or fade changed during playback was not heard until the next
play or seek.** `usePreview`'s `sync` signature covered the stack, the effects
switch and the measurement — and **not the region**. `PreviewGraph.update`
rebuilds the stack chain and never touches the envelope, so nothing wrote the new
envelope while the clock was running.

Ticket 019 promised "a slider moved during playback is heard at once" for the
stack. This ticket gave the region its own sliders, and they are the same promise.
The fix is one line in the schedule effect: when the region changes and playback
is running, reschedule from the current position.

Measured after the fix: paused, a gain change schedules nothing — there is no
clock to keep in step with. Playing, `gainDb: -12` reaches the graph at position
**0.386 s** and `fade.inMs: 750` at **0.641 s**, both at once.

### The reconciler

One direction only: **the store is the truth and the waveform is a picture of
it.** Every gesture writes to the store first, and the store's change brings the
drawing effect back to draw the result. There is no second place that decides
where a region is.

Two facts from the plugin's source make it safe:

- **`setOptions` emits nothing.** It sets `start`, `end` and `color`, calls
  `renderPosition()`, and never touches the emitter. So writing a correction back
  cannot start a loop.
- **`addRegion` and `remove()` emit synchronously**, so those two need a guard.
  An `applying` ref carries it, and only a region the *user* dragged into being
  reaches the store from `region-created`.

`minLength` cannot be changed after creation — `setOptions` leaves it out on
purpose — so a view switch redraws rather than adjusts. Simple view keeps the
**5 second** minimum this card has enforced since before the map; Advanced view
uses **0.05 s**, because split on silence cuts spoken phrases and a 5-second floor
would refuse most of them.

### Measured

- Six regions each rename, resize and delete, and every change survives a
  remount digit for digit.
- **A playing card renders zero times** — `window.__renders` is empty across
  3 seconds and 12 `timeupdate` events, with the list mounted and the magnet
  registered. Ticket 020's figure, unchanged.
- **No wavesurfer instance is rebuilt** — 1 before playback, 1 after.
- **Editing one card redraws only that card.** One gain change gave
  `AudioEditor:phrases.wav` 4 and `RegionList:phrases.wav` 2; `hits.wav` does not
  appear in the counts at all. Ticket 009's rule holds.
- Gain and fade are proved on the exported bytes as well: −6 dB reads
  **−5.999 dB**, and a 500 ms fade in reads 0.0937 at 100 ms, 0.2539 at 250 ms
  and 0.5 after 600 ms — a linear ramp, to the number.

## Amended — 2026-08-20, after seeing it

**The list is gone. Every per-region control is now on the region itself.**

The grilling answer — a list of rows under the waveform, with gain and fade
sliders on the selected row — was built, looked at, and rejected on sight. The
reason it was wrong is worth writing down, because it is not obvious from a
requirements list:

> A row of sliders below the waveform asks the user to look away from the thing
> they are editing, and then to work out which row goes with which region.

Every DAW puts these on the clip, and that is why.

### What replaced it

| Control | Where | Gesture |
|---|---|---|
| Fade in, fade out | a grip at each **top corner** | drag sideways |
| Region gain | a line **across** the region | drag up or down |
| Name | a label at the **top left** | double-click, then type |
| Delete | an ✕ at the **top right**, on hover | click. Or the Delete key |
| Split on silence, snap, add | a **toolbar above the waveform** | the three settings are in a popover |

The Advanced panel is **two** sections now, not three. *Regions cut* left it
entirely; **Sound** and **Export** stay.

### Three things this had to get right

1. **A grip must not drag the region.** The plugin makes the whole region
   draggable, so every handle calls `stopPropagation` on `pointerdown` — and
   deliberately lets `click` bubble, so pressing a grip still selects the region.
   Measured: a 20-pixel gain drag left `region.start` at 1, untouched.
2. **The name must not be drawn twice.** The card passed `content` to the plugin
   and the overlay drew its own label. **Simple view alone gets the plugin's
   label** now; Advanced draws the one you can type into. A view switch rebuilds
   every region anyway — `minLength` differs and cannot be changed after
   creation — so this is decided once per region.
3. **An overlay must draw itself the moment it attaches.** React runs a child's
   effects **before** its parent's, so the redraw pass ran before the card had
   made the region to hang the overlay on. Every overlay came up blank: no name,
   no gain line, grips stacked in the corner. It now draws from a ref set during
   render, so attaching and redrawing cannot be out of order.

### Measured, on the running app

| Gesture | Result |
|---|---|
| Gain line dragged up 20 px on a 120 px region | 0 dB → **+6.0 dB** (20/120 × 36 dB, exactly) |
| The region during that drag | **did not move** |
| Fade-in grip dragged 100 px right | 20 ms → **891 ms** (100/1171 px of 10.2 s, exactly) |
| Fade-out grip dragged 60 px left | **543 ms** |
| History entries per drag | **1** each |
| Double-click the label, type, blur | name written, label updated |
| ✕ on the region | region deleted, card says "No regions" |
| One Ctrl+Z after that | region restored **exactly** |
| A playing card's renders | **0**, across 3 s and 12 `timeupdate` events |
| wavesurfer instances rebuilt | **0** |

### Simple view is untouched

Its region keeps `rgba(254, 242, 242, 0.25)` — the colour it has always had —
draws the plugin's own label, has no overlay children, and shows no toolbar. The
selected shade is **Advanced only**, because Simple draws one region and there is
nothing to tell apart. Exported bytes are still identical to `b690dbb`:
5,292,044 bytes, `99fbd8ef…07a7` and `f32d6274…0c7e`.

### What it cost

`RegionList.tsx` and `RegionTools.tsx` are deleted. Three new modules:
`region-geometry.ts` — pure maths, 27 tests in Node — `region-overlay.ts`, which
is plain DOM because the region element belongs to the plugin and React cannot
own a node another library creates, and `RegionInlineControls.tsx`, which is the
wiring. `pnpm test` 295 → **322**.

Simple bundle 117.98 → **119.43 KiB gzip**. No Advanced-only module is in it,
checked by string: the overlay, the geometry, the toolbar and the split settings
are all absent. The growth is in the shared path, and it was not isolated
further.
