# 025 — Split on silence

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was [022 — The region list and its gestures](./022-region-list-and-gestures.md)
and [024 — Build undo: the command history](./024-build-undo-command-history.md), both closed 2026-08-20

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

## Resolution — 2026-08-20

**Built.** The maths is [`silence.ts`](../../src/lib/silence.ts), pure over
`Float32Array` and read by Vitest under Node. The decoding, the chunking and the
progress are [`region-tools.ts`](../../src/lib/region-tools.ts).

### The padding rule holds by construction, and nothing had to move

`clampSilenceSettings` makes two things true:

- padding is never below `DEFAULT_FADE_MS`, which is 20 ms;
- a gap shorter than `2 × DEFAULT_FADE_MS` is never counted as silence.

An interior edge takes **at most half the gap** as padding, so its padding is at
least `min(padding, minSilence / 2)` — and both of those are at least 20 ms.
**So every interior ramp sits entirely inside the silence, and the fade stays at
the default.** No per-edge fade arithmetic exists, because none is needed.

A region that starts where the **file** starts has no silence in front of it and
gets no padding. Its fade stays at 20 ms anyway: a ramp over real audio is far
better than the click that opening at full level would make.

**Clamped, not refused** — the ticket allowed either. A user who types 5 ms of
padding has asked for something that makes every region click, and the honest
answer is the nearest sane thing with the control showing what happened. A
refusal they cannot act on teaches them nothing.

### The five things weighed

1. **RMS over a 20 ms window**, not peak. A peak reacts to one stray sample, so a
   single click in a silent room would read as speech. 20 ms is about one pitch
   period of a low male voice, so a window never lands inside one glottal closure
   and reads as silence. Silence reads `-Infinity`, not `0`, so a threshold
   comparison is correct with no special case.
2. **Where it runs.** Standing rule 7. The scan is cut into 2000-window chunks —
   40 seconds of audio each — and the page runs between them. `subarray` shares
   the samples, so chunking costs no memory at all. The yield is a
   `MessageChannel` message, not `setTimeout(0)`: the timer is clamped to about
   4 ms once a few nest, and a 45-minute track is 68 chunks.
3. **It needs the decoded audio and does not keep it.** The buffer goes out of
   scope; what survives is a list of numbers. Ticket 007's rule, and what
   `AudioService.measureFor` already does.
4. **Defaults measured, not guessed at**: −40 dBFS, 500 ms, 100 ms. Each was
   checked to move the result in the direction it claims.
5. **The degenerate cases are legal.** No silence gives one region; a silent track
   gives zero.

### Measured

- A file of seven bursts with 800 ms gaps gives **seven** regions.
- **Every interior region edge sits in the silence, not on the attack** — proved
  by reading samples, not by looking at the waveform. The peak in the 20 ms around
  every interior boundary is **0**. The only non-zero peaks are region 1's start
  and region 7's end, which are the file's own two ends.
- Burst 2 runs 1.8–2.8 s and its region is **1.7–2.9 s**: 100 ms of padding at
  each edge, to the millisecond.
- Threshold, minimum silence and padding each change the result the way they
  claim, and a padding under the fade is clamped rather than obeyed.
- **One undo entry**, labelled "Split on silence", restores the previous region
  list exactly. Confirmed on the running app.
- `pnpm test` covers the detection as a plain function over `Float32Array`,
  including the invariant `rampsSitInSilence`, which is asserted rather than
  claimed in a comment.
