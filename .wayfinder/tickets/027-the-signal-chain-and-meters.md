# 027 — The signal chain and the meters

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was the Sound half of the map's *Advanced panel layout*
fog, graduated 2026-08-20

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

The Sound section was one slider and a note saying the rest was not built. Make
it graphical, and give the user live input and output meters for what is
playing.

## Decided with the user, 2026-08-20

Three questions, three answers, all the user's:

| Question | Answer |
|---|---|
| What shape should the Sound section take? | **A signal chain** — the stack drawn as blocks, left to right, with a meter at each end. Click a block to open its own control. |
| How far should the effects go? | **Wire EQ and compressor for real.** They change what you hear and what you export. |
| Where do the meters live? | **Both places** — a small pair on the transport row, the tall pair bookending the chain. |

The chain shape was chosen over a stack of tall editors and over a wall of
knobs. It is the only one of the three that matches the domain model: the edit
stack **is** an ordered list, and drawing it in order makes the order visible.
It also gives the meters somewhere honest to live — the two ends of the thing
they measure.

## Resolution

### The chain

`BLOCKS` in [`signal-chain.ts`](../../src/lib/signal-chain.ts) is
`CANONICAL_ORDER`, and **a test asserts it**. Two lists that had to agree and
did not would put the picture out of step with the sound, which is the one thing
this panel must never do.

A block is switched on with its own dot and opened by clicking its name. Noise
reduction is drawn, marked **not built**, and cannot be switched on — it needs
an `AudioWorklet` and a measured noise profile, and neither exists.

Switching a block on never changes the sound: every default is unity. An EQ
arrives with three bands at 0 dB, a gain arrives at 0 dB. A block that arrived
with a curve already in it would make its own switch an edit.

### Inherited until touched

A track with no stack shows the master defaults' chain, marked *inherited*.
Changing anything writes that chain onto the track, which then stops following
the master switches. **Reset** gives it back. That is ticket 003's override
model, unchanged, and `countAdvancedSettings` now counts it — a Simple view user
carrying an EQ reads "1 Advanced setting active".

### The two graphical editors

Both reproduce the Web Audio node's **own** formula, not an approximation that
looks about right:

- `eqResponseDb` is the RBJ cookbook with Web Audio's reading of `Q` — and that
  reading is **not one thing**. `lowpass` and `highpass` read `Q` in decibels;
  `peaking`, `bandpass`, `notch` and `allpass` read it as a plain number; the
  two shelves ignore it. A test pins the tell: a low pass reads exactly `Q`
  decibels at its own cutoff, for Q of −6, 0, 3, 6 and 12.
- `compressorOutputDb` is `DynamicsCompressorNode`'s three-part transfer
  function, with the quadratic knee. A test walks the whole curve at 0.1 dB
  steps and asserts there is no step anywhere.

**There is no moving dot on the compressor curve.** The meters tap the ends of
the whole chain, not the ends of that one block, so a dot placed from them would
be in the wrong place whenever anything sits before the compressor — and it
would be believed. The honest live numbers are the two meters and the
difference between them.

### The meters

Two `AnalyserNode`s, **in** the audio path rather than hanging off it. A node
with no route to the destination is not guaranteed to be pulled, and a meter
that read zeros on one browser and not another would be worse than no meter.
Where they sit is the whole meaning of the pair:

```
  source ─▶ envelope ─▶ [input] ─▶ the stack ─▶ [output] ─▶ speakers
                         dry                     wet
```

Dry is **after** the region's own gain and fades and **before** the track's
stack — exactly where "Preview effects: off" cuts, so the pair measures the
stack and nothing else.

Nothing about a meter is React state. `useMeterPair` writes to a canvas and to
`textContent` from one shared animation frame loop. Ticket 020 removed a redraw
storm caused by `timeupdate`; a level changes sixty times a second, which is the
same fault an order of magnitude worse.

One loop for every meter on the page, so every bar gets the same timestamp and
the same elapsed time. Two meters showing one signal then move together, which
is the only way an input and an output meter can be compared by eye.

### Undo covers the sound now

`TrackSnapshot` carries the stack, and **every** snapshot carries it. A snapshot
that held only regions would be a partial write — a region drag would put the
stack back to `undefined` and throw the track's EQ away. One EQ drag is one
undo entry, by the same gesture counter the region overlays use.

`snapshotsEqual` no longer serialises a noise profile's `Float32Array`. Nothing
reaches that branch today; a comparison that quietly became a hundred times
slower is exactly the fault that never gets traced back to one line.

## The defect the meters found

**Preview played 0.541 dB louder than the file it was previewing.**

`compressorSegment` divides out the makeup gain Chromium adds on its own.
`makeupGain` is synchronous and answers 1 for settings nobody has measured, so
`calibrateAll` has to have run first. `render.ts` called it. `usePreview` never
did. The limiter is unconditional, so **every** preview was affected — and it
quietly stopped being affected after the first export, because the cache is
shared.

ADR 0001 promises what you hear and what you export cannot disagree. They did,
by half a decibel, for as long as preview has existed. It is inaudible and it
was never going to be found by ear.

`usePreview` now builds the chain at once, calibrates, and builds again — with a
guard so a stale plan cannot overwrite a newer one.

## Measured

Every number below is from the running app, on a 12-second 1 kHz tone at exactly
−20.00 dBFS peak, −23.01 dBFS RMS.

| What | Reading |
|---|---|
| Input meter, tone alone | **−23.0** — the tone's own RMS, to the tenth |
| Output meter, before the calibration fix | −22.5 · **+0.5** — Chromium's undivided makeup |
| Output meter, after it | −23.0 · **+0.0** |
| EQ dragged to +6.0 dB at 1 kHz | store reads **1000 Hz, +6.000 dB**, other bands unmoved |
| Output meter, with that EQ | **+6.0** |
| The exported file, with that EQ | **−17.01 dBFS** against a −23.01 source — **+6.00** |
| A four-block chain: EQ, compressor, +6 gain, limiter | preview said **−6.2**, the exported file measures **−6.19** |
| Undo, after the EQ drag | +6 dB → 0 dB; a second undo returns the track to inherited; two redos restore |
| History entries per drag | **1**, from 12 pointer moves (EQ) and 10 (compressor threshold) |
| Renders during playback | **0**, across 181 animation frames |
| Meter loop cost | **0.062 ms** a frame — 0.37% of a 60 Hz budget |
| Compressor threshold handle dragged | −8 → **−24.00 dB**, ratio and attack untouched |

Simple view is untouched: no chain, no meters, no toolbar. The chip reads
"1 Advanced setting active" for a track carrying an EQ, which is the warning it
exists to give.

**Bundle.** Simple view 119.43 → **120.26 KiB gzip**. The 0.83 KiB is all
shared-path code — the two taps in `preview.ts`, `peakOf` and `rmsOf` in
`dsp.ts`, `setTrackStack` in the store, the stack in the snapshot.
`AdvancedPanel` 4.22 → **10.28 KiB gzip**, on demand, plus `meter-canvas` 1.11,
`ToolControls` 1.01, `useMeterPair` 0.61 and `TransportMeters` 0.44. No
Advanced-only string is in the Simple bundle, checked by search.

`peakOf` and `rmsOf` live in `dsp.ts` and not in `meter.ts` for that reason, and
that reason only: the preview path calls them, and a `meter.ts` that held them
would drag the ballistics, the scale and the formatting into a bundle that never
draws a meter. Standing rule 6.

## Amended — 2026-08-20, after seeing it

> *"If we have a loudness setting as part of the actual signal chain, we don't
> need it on the top here."*

Right. The Sound section opened with a **Loudness target** slider and the chain
below it held a **Loud** block, and both said LUFS. One screen, two targets.

They are not the same number, and that is the only reason one of them stayed:

| Control | Sets | For |
|---|---|---|
| the toolbar's target | the master default | every track that has not claimed its own chain |
| the chain's Loudness block | that track's own target | one track |

Deleting the master one outright would have cost the thing it exists for —
bringing a **batch** to one loudness in a single action, which is what
"Normalize Levels? Yes" promises. So it **moved** rather than went: it is on the
master toolbar now, directly under that switch, where the other master defaults
live. The switch decides whether; the target decides to what.

`LoudnessTarget` is Advanced view only and `MasterToolbar` is in Simple view's
bundle, so it is reached through a dynamic import — its own 0.40 KiB gzip chunk.
Standing rule 6, and ticket 010's rule holds: Simple view still shows one Yes/No
switch and nothing else.

Verified: master target −16 LUFS on the toolbar and the track's own −9 LUFS in
its Loud block, at the same time, neither touching the other. Simple view shows
neither. Simple bundle 120.26 → **120.35 KiB gzip**; `AdvancedPanel` 10.28 →
**10.09**.

## Amended again — 2026-08-20

> *"We should have toggle switches on each effect rather than a tiny clickable
> dot."*

The block's on/off control was a **2 × 2 pixel** dot. It asked the user to aim
at something the size of a full stop, and being round told them nothing about
which way it was set.

It is the app's own `Switch` now — the same component **Preview effects** uses,
at the same **36 × 20** CSS pixels. That is a hit target eleven times the area,
and its shape says on or off from across the room.

No bundle cost: `PreviewEffects` renders in both views, so
`@radix-ui/react-switch` was already in Simple view's bundle. `AdvancedPanel`
10.09 → **10.05 KiB gzip**; Simple view unchanged at **120.35**.

The tile is `6.75rem` wide now — the name on the left opens the block, the
switch on the right turns it on. Two targets, two jobs. Only the name and the
summary dim when a block is off; the switch stays at full strength, because a
dimmed switch is the one control you cannot read when you need to.

Measured: switching **Equalizer on** adds `eq` in canonical order — `eq`,
`loudness`, `limiter` — sets `aria-checked="true"` and writes **1** history
entry. Switching it off removes it and writes **1** more. The **Noise
reduction** switch is `disabled`; clicking it changes nothing at all. Two undos
return the track to inherited.

## What this did not answer

- **The Export section's layout.** Half the fog patch this graduated from. Still
  a form, still fog.
- **Reordering the chain.** The blocks are drawn in canonical order and cannot
  be dragged. The map already has the hole that would need filling first: there
  is no level-setting slot before the compressor, so the canonical order cannot
  express Simple view's own "both switches on" stack.
