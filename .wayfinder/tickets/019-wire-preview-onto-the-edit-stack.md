# 019 — Wire preview onto the edit stack

**Type:** `wayfinder:grilling`
**Status:** closed
**Assignee:** build session with the dev, 2026-08-19
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

The card's play button plays the file. It should play the region, through the
stack. What has to change, and what breaks when it does?

Raised by [008 — Build the edit stack](./008-build-the-edit-stack.md), which
built the path and did not wire it.

## Where this stands

[`src/lib/preview.ts`](../../src/lib/preview.ts) exists. It calls the same
`buildGraph` the export path calls, given a live `AudioContext`, so what you
hear and what you export **cannot** disagree. That is
[ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md).

**Nothing calls it.**

The card plays through wavesurfer, which owns an `<audio>` element and its own
playhead, scroll, click-to-seek and `region-out` handling. So today the play
button plays the raw file, with no region gain, no fades and no operations.
Nobody has noticed, because Simple view has no operation a user can hear until
they export.

Ticket 008 stopped here on purpose. Ticket 008's job was the engine, and moving
playback is a UI change with its own failure modes.

## What must be decided

1. **Who owns the sound.** wavesurfer plays its own `<audio>` element. Options:
   mute wavesurfer and play the Web Audio graph beside it, or feed wavesurfer's
   media element into the graph with `createMediaElementSource`. The second keeps
   one clock; the first keeps one code path. They cannot both be true.
2. **The playhead.** wavesurfer draws its cursor from its media element's
   `currentTime`. A graph driven by `AudioBufferSourceNode` has no media element.
   Something has to drive the cursor.
3. **Seeking.** Clicking the waveform restarts an `AudioBufferSourceNode`; it
   cannot be scrubbed. Every seek is a stop and a fresh `start(when, offset)`.
   Compressors and EQ have memory, so the first moment after a seek settles
   differently — every DAW behaves this way, and the design says so.
4. **Where the decoded buffer comes from.** The worker boundary design section 6
   says **no decoded buffer is ever cached**. Preview needs one for as long as it
   plays. Is preview an exception, and if so what is its ceiling?
5. **The Preview effects switch.** `preview.ts` takes `effects: boolean` and the
   design gives it one switch, on by default. Where does it live, and does it
   count as an Advanced setting on the chip?

## Watch for

**This is the first thing that makes the 1 GB ceiling bite.** A track that is
merely loaded costs its encoded file. A track being previewed costs its decoded
buffer too — 115.2 MB for five minutes, 1.04 GB for forty-five.

## Acceptance

Playing a region and exporting it produce the same audio, proved by ear on a
setting that is audible, and by the region's own gain and fades being present in
both.

---

## Resolution — 2026-08-19

**Built. The play button plays the region through the edit stack.**

Six decisions, taken with the dev in two rounds.

### 1. wavesurfer's own element feeds the graph

`createMediaElementSource` on the element wavesurfer already owns, rather than a
second `AudioBufferSourceNode` beside it.

**The reason is memory.** A buffer-source preview would share the samples as well
as the operations — and hold a decoded buffer for as long as the track is on
screen. That is 115.2 MB for five minutes and **1.04 GB for forty-five**, against
a 1 GB ceiling that already counts every loaded file. The media element streams,
so nothing is held and the ceiling never bites.

This answers three of the five questions this ticket asked outright:

- **The playhead** does not move. wavesurfer keeps its element and its cursor.
- **Seeking** does not change. The element seeks natively; nothing restarts.
- **The decoded buffer** does not exist, so preview is not an exception to
  "no decoded buffer is ever cached" and needs no ceiling of its own.

**One consequence, written down because it is not obvious.**
`createMediaElementSource` is a one-way door: an element routed into a graph can
never play on its own again, and a second call for the same element throws. So
**"Preview effects: off" is a chain with no operations, not a bypass** — there is
nothing to bypass to.

### 2. ADR 0001 is held to properly, not nominally

`buildGraph` was split. `linkStack` is now the one implementation of the
operations chain and **both paths call it**:

```
  export:  AudioBufferSourceNode ──▶ region envelope ──▶ linkStack ──▶ render
 preview:  MediaElementAudioSource ─▶ region envelope ──▶ linkStack ──▶ speakers
                                      └──────── shared ─────────┘
```

`scheduleRegionEnvelope` is shared the same way, so a fade cannot be one shape on
export and another in preview. A second copy of either loop would satisfy the
letter of the ADR and break its point.

### 3. Measure on demand, up to ten minutes

Loudness and peak normalization cannot know their gain until something has heard
the whole region, and hearing it means decoding it. The wait tracks length:

| Track | Wait | Decoded, 44.1 kHz stereo |
|---|---|---|
| 30 seconds | ~0.15 s | 10.6 MB |
| 5 minutes | ~2.3 s | 105.8 MB |
| 10 minutes | ~5 s | 211.7 MB |
| 45 minutes | ~23 s | 952.6 MB |

Ten minutes is where five seconds stops being a pause and starts being a freeze.
**Above it, preview says the level is not normalized and offers to measure
anyway** — it never decides quietly, which is how the memory ceiling already
behaves.

The measurement is cached on file name, region bounds, stack and sample rate, and
**an export fills the same cache**, so the first play after a slice is instant and
hears exactly what was sliced. Numbers only: no `AudioBuffer` is kept anywhere.

The rate is the **export** rate, not the file's own. Preview plays the element at
whatever rate the file is, but the gain it applies has to be the gain the export
would apply.

### 4. The Preview effects switch is on the card, in both views

Ticket 010's rule — Simple view gains no new control — was written about the
loudness target, a number that needs audio knowledge. This is a listen switch. It
changes no exported file, and a Simple user who cannot hear the raw cut cannot
tell what the two switches did.

It is **not** counted on the Advanced settings chip, for the same reason: the
chip warns that an export is not what Simple view describes, and this never is.

Per track and not persisted — the same rule regions follow, because it belongs to
a file the browser cannot re-open.

### The acceptance, measured rather than heard

An `AnalyserNode` was patched onto everything connecting to the speakers, and
preview was played whole with **Normalize Levels: Yes** at −14 LUFS.

The analyser reads a **mono downmix**, so it under-reads a stereo peak by a fixed
amount. That bias cancels in a ratio, so the comparison is of **gains**:

| | Preview (analyser) | Export (ffmpeg) |
|---|---|---|
| Stack bypassed | peak −13.19 dBFS | raw region, peak −10.4 dB |
| Stack applied | peak −3.85 dBFS | peak −1.0 dB |
| **Gain the stack applied** | **+9.34 dB** | **+9.40 dB** |
| RMS, same two states | −32.69 → −23.16 | −29.8 → −20.5 |
| **Gain by RMS** | **+9.53 dB** | **+9.30 dB** |

**0.06 dB apart on peak.** The export's true peak reads −1.0 dBFS, which is the
−1 dBTP ceiling landing exactly where it should.

The region's gain and fade edges are shared code and are covered by 21 tests,
including four for the case this ticket could not have guessed at: **seeking into
the middle of a fade**. The envelope resumes from where it would already have
been rather than starting over.

### Two defects found by testing, both fixed

**1. A routing failure blanked the whole card.** `attachPreview` guarded against
double-routing with a module-level `WeakMap`, and a hot reload made a second
module instance with an empty map. `createMediaElementSource` threw, React
propagated it, and the card disappeared. Two fixes: the graph is now remembered
**on the element itself**, which survives module re-instantiation; and the hook
catches the failure and plays unprocessed. Preview is a convenience; the export
is the product, and it must not be able to take the page down.

**2. A dev-only handle broke the test suite.** `import.meta.env.DEV` is true under
Vitest, which runs in plain `node` with no `window`. That is ticket 006's rule and
the guard now checks `typeof window` too.

### One finding that is not this ticket's

**The track card re-renders about 60 times a second while playing, and always
has.** `@wavesurfer/react`'s `useWavesurfer` calls `setCurrentTime` on every
`timeupdate`; the card never reads that value, and React cannot know.

Measured on `clip-30s.wav`, three seconds of playback:

| | Renders |
|---|---|
| preview enabled | **172** |
| preview disabled | **382** |

**Preview adds none.** Raised as
[020 — The track card redraws on every timeupdate](./020-card-redraws-on-timeupdate.md).

### Bundle

| Asset | After 011 | **After 019** |
|---|---|---|
| `index.*.js` gzip | 113.34 KiB | **115.40 KiB** |
| `AdvancedPanel.*.js` gzip | 3.64 KiB | 3.64 KiB |

**+2.06 KiB** for the preview graph, the hook, the switch and Radix's `Switch`.
It is in the Simple bundle on purpose — decision 4 puts the switch in both views.

`pnpm test` is 165 → **186 tests**.
