# 026 — Snap to transients

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [022 — The region list and its gestures](./022-region-list-and-gestures.md)
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

While the user drags a region edge, make it land on a transient. What is a
transient here, and how strong is the magnet?

## Decided in grilling, 2026-08-20

The name is ambiguous and the two readings are different features. Grilling
picked one:

| Decision | Answer |
|---|---|
| What snap is | **a magnet on a drag.** While it is on, every edge you drag lands on a transient. |
| What snap is not | a one-shot button that moves existing edges |
| What snap is not | a region maker |
| Where the control lives | the Advanced panel's **Regions** section |

**"Split at transients" — one region per transient — is a real feature and it is
a different one.** It is a sibling of
[025 — Split on silence](./025-split-on-silence.md): detect, then cut. It is
**out of this stretch** and sits in the map's Not-yet-specified section.

Snapping is a drag behaviour, like grid snap. It helps every gesture instead of
one button.

## What to weigh

1. **Detection.** Onset detection has **no standard to match**, unlike LUFS in
   ticket 005 — so there is no reference implementation to check against.
   Candidates: energy rise, high-frequency content, spectral flux. Each is a
   plain function over `Float32Array`, so Vitest tests it in Node.
2. **When it runs.** Detecting on every drag is far too slow. Detect **once per
   track** and cache it, the way
   [`preview-measurements.ts`](../../src/lib/preview-measurements.ts) caches
   measured gains — an LRU keyed on file, region, stack and rate.
3. **Magnet strength.** A snap radius in pixels or in seconds. Pixels scales with
   zoom, which is what a user expects from every other editor.
4. **Escape.** A user must be able to put an edge where there is no transient. A
   modifier key that suspends the magnet while held is the usual answer.
5. **wavesurfer has no snap hook.** The magnet has to run in the region's
   `update` handler — which fires **during** the drag, with the side — and write
   back through `region.setOptions()`. Confirm that writing during `update` does
   not fight the drag it is inside.

## Watch for

- **Ticket 020's rule.** Every listener is collected and removed by name.
- **`region-update` fires continuously while dragging.** Detection must already
  be cached by then, or the drag stutters.
- **Ticket 007's rule.** Detection needs the decoded audio and must drop it, the
  same as ticket 025.

## Acceptance

- On a drum loop, dragging an edge near a hit lands **on** the hit, within a
  tolerance the resolution states in milliseconds.
- **Detection runs once per track, not once per drag** — counted, not assumed.
- Switching the magnet off makes an edge land exactly where it is dropped.
- With the magnet off, drag behaviour is unchanged from before this ticket.
- **A playing card still renders zero times**, ticket 020's figure.
- `pnpm test` covers the detection as a plain function over `Float32Array`.
