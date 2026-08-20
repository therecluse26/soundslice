# 025 — Split on silence

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [022 — The region list and its gestures](./022-region-list-and-gestures.md),
[024 — Build undo: the command history](./024-build-undo-command-history.md)
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Cut a track into one region per non-silent stretch. What counts as silence, and
what does the user control?

## Decided in grilling, 2026-08-20

| Decision | Answer |
|---|---|
| What it produces | **one region per non-silent stretch. The silence is dropped.** |
| Region edges | each region keeps a **padding** of silence at each end |
| Padding default | about **100 ms** |
| Pops | **sharp fades at each edge**, so no boundary is a discontinuity |
| Settings | **threshold** in dBFS, **minimum silence length** in ms, **padding** in ms |
| Effect on existing regions | **replaces** them |
| Undo | **exactly one entry** |
| Where the control lives | the Advanced panel's **Regions** section |

### The padding rule, and why it works

**The padding must be at least as long as the fade.**

A region already owns `fade: { inMs, outMs }`, defaulting to 20 ms — that is
`DEFAULT_FADE_MS` in `src/lib/edit-stack.ts`, and it has applied to every slice
since before this map existed.

With 100 ms of padding and a 20 ms fade, **the ramp sits entirely inside the
silence**. It never touches the attack, and the boundary is still ramped, so
there is nothing to pop. A padding shorter than the fade eats the attack, which
is the exact fault the fade is there to prevent.

## History: this is not the old Trim Silence

`trimSilence` used to be a master toolbar switch. It read an `AnalyserNode`
**before** the offline render ran, so it read zeros and could not work as
written. Its control has been commented out since before this map existed, and
`ExportSettings` dropped the field in ticket 008.

This ticket is its replacement, and the shape is different: **a region tool, not
a switch.** It makes and moves regions; it does not change sound
([`designs/edit-stack.md`](../designs/edit-stack.md) §3).

## What to weigh

1. **Detection.** RMS over a window, or peak? Which window length? Both are plain
   functions over `Float32Array`, so Vitest tests them in Node — `dsp.ts`'s rule,
   and the reason ticket 006 could exist at all.
2. **Where it runs.** Standing rule 7: no audio work on the main thread, and
   anything over 300 ms shows progress. A 45-minute track is a lot of samples.
3. **It needs the decoded audio, and must not keep it.** Ticket 007 caches no
   decoded buffer, and `AudioService.measureFor` already decodes, measures and
   **drops** the buffer. Follow that.
4. **Defaults.** −40 dBFS, 500 ms of minimum silence and 100 ms of padding are a
   reasonable start. Measure them against real speech and real music before
   committing to them.
5. **The degenerate cases are legal.** A track with no silence gives one region.
   A silent track gives zero. Ticket 021 already allows zero.

## Acceptance

- A file with four spoken phrases and clear gaps gives **four** regions.
- **Every region edge sits in the silence, not on the attack** — proved by
  reading samples at the boundary, not by looking at the waveform.
- Threshold, minimum silence length and padding each change the result in the
  direction they claim.
- A padding shorter than the fade is refused or clamped, and the resolution says
  which and why.
- **One undo entry restores the previous region list exactly.**
- A 45-minute track shows progress and does not freeze the page — measured the
  way ticket 002 measured it, by counting frames drawn.
- `pnpm test` covers the detection as a plain function over `Float32Array`.
