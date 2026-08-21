# 028 — Join: a track's regions as one file

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was the single-file half of the map's *join strip* fog,
graduated 2026-08-20

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

One track with six regions exports six files. That is right for a sample pack
and wrong for a recording: split a podcast on silence and you want **one** clean
file back, not sixty fragments. Build the choice.

## Decided with the user, 2026-08-20

Only the single-file export path. The reorder strip and the draggable crossfades
the map also charts stay fog.

| Question | Answer |
|---|---|
| What comes out | **One file per track.** Ten tracks give ten files. |
| Where regions meet | **Butt join.** End to end, each keeping its own gain and 20 ms fades. Output length is the exact sum of the region lengths. |
| The order | **By start time** — `orderedRegions`, the order the region numbers already show. |
| Where the control lives | **Master toolbar, under Output Format.** |
| Also fixed | Simple view's batch export, and the repeated decode. Both the user's call. |

The user's words were *"export regions as separate files"*. The project already
had the word — **Join**, in `CONTEXT.md` since before this map — so the control
reads `Separate files | One joined file`, which is also the map's own wording at
`map.md:120`.

## Resolution

### A join is not a new render

It is the render this app already does, **with N sources instead of one**.

```
   one      source ──▶ envelope ──────────────────────▶ linkStack ──▶ out
   joined   source ──▶ envelope_0 ┐
            source ──▶ envelope_1 ├──▶ bus ──▶ linkStack ──▶ out
            source ──▶ envelope_k ┘
```

`GraphPlan.region: Region` widened to `regions: readonly Region[]`, and
**`regions.length === 1` is today's behaviour, byte for byte**. The word "join"
never reaches `graph.ts` or `render.ts`; only `audio-service.ts` knows it, and
only to decide how many regions go into one plan item. Standing rule 1 and
ADR 0001 held without arguing for an exception.

Three things needed **no change at all**, and each was built for something else:

- `linkStack` takes any `from: AudioNode` — preview already feeds it an
  `AnalyserNode`.
- `scheduleRegionEnvelope` already took an absolute context `startTime` —
  preview needed it to seek into the middle of a fade.
- N `AudioBufferSourceNode`s share **one** decoded `AudioBuffer`. A 45-minute
  track is 1.04 GB and a join must never hold two.

`buildGraph` keeps `heads.length === 1 ? heads[0] : sumInto(...)`. A unity
`GainNode` is bit-exact either way, so the ternary buys no accuracy — it buys a
reviewer asking *"did the ordinary export change?"* having literally nothing to
compare.

### The stack runs once, over the whole join

That is the difference between joining and gluing N exports together afterwards.
A compressor keeps its envelope across the seams, and a loudness operation
resolves to **one** gain for the file — so two quiet regions and one loud one
keep their relative levels instead of being normalized three different ways.

It cost zero lines. `measureStack`'s truncated (`upTo`) passes already render
the whole timeline up to the measuring operation, so `analyse` hears the file
that will actually be written.

### `joinedTimeline`, in `dsp.ts`

Pure, Node-testable, structural `{ start, end }` in — so `dsp.ts` keeps its zero
imports. Two rules that look like details and are not, each with a test:

- **Offsets accumulate in whole frames, never in seconds.** Adding 0.0213 s a
  thousand times drifts by samples; adding 926 frames cannot drift at all.
- **A span may be 0 frames; only the total floors at 1.** `regionFrameCount`
  floors at 1 because `OfflineAudioContext` rejects a length of 0. A span obeys
  the opposite rule: a region past the end of the file must take up **no room**,
  or every region after it sits one frame late and the error compounds.

It also deleted the clamp that existed **twice** — in `buildGraph` and again in
`renderPass` — which was two chances to disagree about what a region past the
end of the file means.

### The measurement key had to change, or preview would lie

`measurementKey` now takes `readonly Region[]` — **a list always, never a
union**. A joined gain is one number for a whole file; filing it where preview
looks for a single region would play one region at the level the whole file
wants. That is the ADR 0001 divergence this session already had to fix once, for
0.541 dB.

A list of one is identical by content to what a single region produced before,
so a join of one region correctly reuses a measurement an ordinary slice already
paid for. Order is in the key: `[a, b]` and `[b, a]` are different audio.

`measureFor` measures the joined set when join is on, so **the output meter
shows the level the export will produce**. Without it the meters built earlier
today would have been wrong in exactly the mode this ticket adds.

### The two things the user asked for alongside

**Simple view's batch export.** `designs/view-state.md` §4 says the Simple-view
region rule *"applies to both export paths"*. It did not: the card's button
applied `exportableTrack` and the toolbar's **Slice All Files** passed raw
tracks, so a four-region track gave 1 file from one button and 4 from the other.
`exportableTrack` moved to `advanced-settings.ts` and both call it. Load-bearing
here, not merely adjacent: without it Simple view would have joined regions the
user cannot see.

**One decode per track, not per file.** `sliceRegions` decodes when nobody hands
it a buffer, so six regions of one track cost six full reads and six
`decodeAudioData` calls of the same bytes. `renderPlan` now holds the last
decode and reuses it while the file name holds — **at most one buffer at a
time**, dropped on the line that replaces it, so peak memory is exactly what it
was. A map keyed by file name would have held every track at once and broken
ticket 007's ceiling.

### Storage version 4 → 5

`isMasterDefaults` is strict and there is no migration by policy, so a v4 blob is
discarded either way. Bumping makes that deliberate rather than accidental.

**Everyone's stored format, bit depth, rate and loudness target reset once**, on
first load after this ships.

`persistMasterDefault`'s object literal reached `writePersisted` as `unknown`, so
a forgotten key compiled fine and wrote a blob the guard rejects on next load —
every setting lost, nothing pointing back at the line. It now builds a
`MasterDefaults`-typed value first, so the compiler catches it, and the new
`master-defaults.test.ts` — the first test of anything that survives a reload —
compares the **keys** of a round trip, not only the values.

## Measured

All in the running app.

### Byte-identity — the acceptance test

Two regions of a 12-second tone, through EQ → compressor → loudness(−16) →
limiter, WAV 16-bit. Hashes taken **before** any code was written:

| File | Bytes | SHA-256 |
|---|---|---|
| `sliced_tone-1k_1.wav` | 672,044 | `e4851195…94d1` |
| `sliced_tone-1k_2.wav` | 672,044 | `b83d55c4…edad` |

After the whole change, join off: **both hashes identical.**

| Case | Result |
|---|---|
| Join on, same two regions | **one** file, `sliced_tone-1k.wav`, **1,344,044** bytes = 672,000 × 2 + 44 |
| One region, join **off** | `sliced_tone-1k.wav`, `e4851195…94d1` |
| One region, join **on** | `sliced_tone-1k.wav`, `e4851195…94d1` — same name, same bytes |
| Decodes, two regions, join off | **1** (was 2) |
| Decodes, two regions, join on | **1** |

### The podcast case

A 10-second file: three 2-second tones separated by 1.5 s of silence. Split on
silence at the defaults, then join.

| What | Reading |
|---|---|
| Regions found | **3** — [0.400, 2.600], [3.900, 6.100], [7.400, 9.600] |
| Joined output | **6.600 s**, 316,800 frames |
| Frames against the sum of the spans | **equal** |
| Silence dropped | **3.400 s** of 10 |
| One file | `sliced_speech.wav` |
| Worst sample-to-sample step in the whole file | **0.01306**, at **0.106 s** |

That last number is the test for a click at a seam, and it says there is none: a
1 kHz sine at 0.1 amplitude has a natural maximum step of
`2π × 1000 ÷ 48000 × 0.1` = **0.0131**, and the worst step in the joined file is
that slope — inside the first region's own fade-in, not at either seam.

### Preview agrees with the joined export

One loud region and one 12 dB quieter, loudness −16 LUFS only:

| Mode | Preview's gain | The exported file |
|---|---|---|
| Join off | 1.5853 | −19.01 dBFS |
| Join on | 2.1775 | −16.25 dBFS |

The two gains differ by `20·log₁₀(2.1775 ÷ 1.5853)` = **2.76 dB**, and the two
files differ by **2.76 dB**. Preview and export agree in each mode, and correctly
disagree with each other.

### Naming, and both buttons

`planSlices` over `clip.wav` (2 regions), `clip.mp3` (3), `solo.wav` (1) and
`empty.wav` (0):

| Join | Result |
|---|---|
| off | `sliced_clip_1/2.wav`, `sliced_clip_1 (2).wav`, `sliced_clip_2 (2).wav`, `sliced_clip_3.wav`, `sliced_solo.wav` |
| on | `sliced_clip.wav`, `sliced_clip (2).wav`, `sliced_solo.wav` |

`empty.wav` produces nothing either way, and `sliced_solo.wav` is **the same
name in both modes**.

A 2-region track and a 3-region track, by view and button:

| View | Card's Slice Audio | Toolbar's Slice All Files |
|---|---|---|
| Simple, join off | 1 + 1 | **2** (was 5) |
| Simple, join on | 1 + 1 | **2** |
| Advanced, join off | 2 + 3 | 5 |
| Advanced, join on | 1 + 1 | 2 |

Join changes nothing in Simple view, which is right: one region joined is the
same file, with the same name.

### Tests and bundle

`pnpm exec vitest run` 414 → **446**. New: 15 for `joinedTimeline` in
`dsp.test.ts`, 15 in the new `master-defaults.test.ts`, 2 for
`isAdvancedExportChoice`.

Simple view's bundle 120.35 → **120.74 KiB gzip**. The 0.39 KiB is shared-path
code — `joinedTimeline`, the plan's branch, the store's field. `JoinRegions` is
its own **0.34 KiB gzip** chunk, and the strings `One joined file` and
`Separate files` appear **0** times in the Simple bundle.

## What this did not answer

- **The join strip.** Reordering the joined regions, and crossfades between
  them. Still fog, and now the only part of it left.
- **Joining across tracks.** The map's own wording says *"regions from any
  track"*. That needs a cross-track order nobody has decided, and a rule for two
  tracks at different rates or channel counts.
- **Cancellation.** A joined 45-minute export is one uninterruptible render
  where a batch had one abandonment point per region. `isCancelled` is still
  typed, still plumbed to `sliceRegions`, and still passed by nobody. The map
  holds it as its own ticket.
- **The half-frame seam.** `source.start`'s `duration` is unrounded seconds
  while the next region's `when` is frame-exact, so a neighbour can overlap or
  fall short by up to half a frame. Deliberate: rounding it would change the
  bytes a single-region export produces today, and a join whose *off* setting
  changed the output would be worth nothing. At a seam both envelopes sit at
  ~0 gain, which is why the click test passes.
