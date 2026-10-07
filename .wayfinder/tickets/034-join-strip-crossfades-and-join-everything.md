# 034 — The join strip, crossfades, and joining across tracks

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *The join strip* and *Joining across
tracks*, graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Ticket 028 built the single-file path: one track's regions, end to end, in
start-time order. Left in the fog: an order that is not start time, a crossfade
and its shape, and the vision's "regions from any track".

The fog also named the trap: `scheduleRegionEnvelope` ramps **linearly**, so
overlapping two regions gives an equal-gain crossfade — correlated material
bumps and uncorrelated material dips about 3 dB in the middle.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| Join modes | Three: **Separate files**, **One file per track**, **One file for everything**. `JoinMode` is `"separate" \| "track" \| "all"`. Storage version 5 → 6. |
| Order | Start time until the user moves a chip. A moved order is stored on the track as `join.order`. **Reset order** goes back to start time and keeps the crossfades. |
| Crossfade shape | **Equal power** — sine and cosine, through `setValueCurveAtTime`. A region's own fades stay linear: they fade to silence, not into other audio. |
| Where a crossfade is stored | On the region **after** the seam, by id, so it moves with that region when the order changes. |
| Range | 0 to 2000 ms in 10 ms steps. Capped when the file is made at **half of each neighbour region**, so a region can never be faded over from both sides and vanish. |
| Zero | A zero crossfade is a butt join, **byte for byte**. |
| Across tracks | Each track renders with **its own stack**, then the results are laid end to end in track order. One rate: the first track's export rate. Channels: the most any track has. |
| Format for "all" | The master format. Overrides are ignored (ticket 033). |

## Resolution

`joinedTimeline` in `src/lib/dsp.ts` gained `crossfadesMs` and returns each
span's `crossfadeInSec` and `crossfadeOutSec`; `equalPowerCurve` draws the
curve. `planSlices` in `src/lib/slice-plan.ts` turns tracks and a mode into
output items for all three modes, and `concatenate` in `src/lib/render.ts` lays
rendered tracks end to end. The strip is
`src/components/custom/advanced/JoinStrip.tsx`; the edits it makes are pure
functions in `src/lib/join-layout.ts`.

**Checked in the browser, `hits.wav` at 48 kHz, 11 regions:**

- One file per track: 264 477 frames against 264 478 expected — one frame of
  rounding.
- Zero crossfade against no layout: **byte-identical**.
- Ten 50 ms crossfades: 240 477 frames, exactly 10 × 2400 shorter.
- Separate files: 11 files.
- One file for everything, two tracks: one item, `sliced_joined.wav`, two parts.
- The strip: Move later reordered 1 and 2; Reset order kept the crossfade.
