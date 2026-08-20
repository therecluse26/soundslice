# 026 — Snap to transients

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was [022 — The region list and its gestures](./022-region-list-and-gestures.md), closed 2026-08-20

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

## Resolution — 2026-08-20

**Built.** A magnet on a drag, as decided. It moves nothing on its own and it
makes no regions. The maths is [`transients.ts`](../../src/lib/transients.ts) and
the drag behaviour is
[`useTransientSnap.ts`](../../src/hooks/useTransientSnap.ts).

### The five things weighed

1. **Detection: energy rise**, and the reason is cost. There is no standard to
   match, so the deciding argument is that the magnet must be right on the first
   drag — which means detecting once over the whole track, 45 minutes of it. A
   spectral method means an FFT per hop; a broadband envelope is one pass, and it
   finds the thing a user is pointing at. Three rules turn a rise into an onset:
   at least **6 dB** between hops, above a **−50 dBFS** floor, and no closer than
   **50 ms** to the last one, keeping the hop that rose hardest of a cluster.
2. **When it runs: once per track**, cached the way `preview-measurements.ts`
   caches gains — bounded, oldest dropped first, keyed on name, size and modified
   time. Two calls while one scan is running share it.
3. **Magnet strength: 12 pixels.** Pixels, not seconds, so it scales with zoom.
   In seconds it would grab a region from the other side of the screen when zoomed
   out, and reach nothing when zoomed in.
4. **Escape: hold Alt.** Read from a ref, because `region-update` fires dozens of
   times a second and React state would redraw the card on every key movement.
5. **Writing during `update` does not fight the drag** — and this is checkable,
   not hopeful. `setOptions` in the plugin's source sets `start`, `end` and
   `color`, calls `renderPosition()`, and **never touches the emitter**. So it
   cannot re-enter the handler. The next frame applies the pointer delta to the
   snapped value, which is what a magnet should feel like: the edge sticks until
   the pointer pulls it free.

The 10 ms hop is not the resolution of the answer. `refineOnset` walks the winning
hop for the first sample that is clearly part of the new sound — twice the
previous hop's level, or a quarter of this hop's peak, whichever is louder.

### It is not in the Simple bundle, and that cost a redesign

Calling this hook from `AudioEditor` pulled onset detection and the decoder into
the Simple bundle: **+4.99 KiB gzip, measured**, for a tool Simple view cannot
switch on. A hook cannot be called conditionally, so it now lives behind
`RegionMagnet`, a component that draws nothing and is imported dynamically.
Standing rule 6.

### Measured

- **Detection accuracy is 0.1 ms.** A file with attacks at 1.8, 3.6, 5.4, 7.2,
  9.0 and 10.8 seconds gives 1.8001, 3.6001, 5.4001, 7.2001, 9.0001 and 10.8001.
  The attack at t=0 is not reported, because the first hop has nothing to rise
  from — by design, and tested.
- **A dragged edge lands on the hit.** An edge at 3.48 s dragged five pixels
  towards the attack at 3.6001 s landed on **3.6001133786848074** — the detected
  transient, exactly.
- **Detection runs once per track, not once per drag** — counted, not assumed.
  `window.__detections` reads `{ "phrases.wav": 1 }` after the switch went on and
  still `1` after a drag.
- **With the magnet off, drag behaviour is unchanged.** A 200-pixel drag moved the
  edge exactly 200 pixels and landed where it was dropped.
- **A playing card still renders zero times**, with the magnet registered.
- `pnpm test` covers the detection as a plain function over `Float32Array`,
  including the binary search the magnet runs on every frame.
