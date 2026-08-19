# Design — the edit stack

Answer to [002 — Design the edit stack](../tickets/002-design-the-edit-stack.md).
Written and grilled 2026-08-19. **Agreed.**

This is the spine of the map. Every feature writes to it.

Four things were settled in grilling that the ticket did not anticipate:

1. **Trim is not an operation.** The region already says which audio you want.
   See [section 4](#4-what-a-region-owns).
2. **The engine is one graph, played two ways.** Not a chain of renders, and not
   our own DSP in a worker. See [section 6](#6-the-render-path).
3. **Web Audio was never what froze the page.** Our own synchronous loops were.
   Measured. See [section 6](#6-the-render-path).
4. **An export no longer follows the machine's sample rate.** See
   [section 10](#10-sample-rate).

There is one ADR: [`docs/adr/0001-one-graph-two-contexts.md`](../../docs/adr/0001-one-graph-two-contexts.md).

---

## 1. The shape, in one picture

```
                 region                          track
        ┌────────────────────────┐   ┌──────────────────────────────┐

file ─▶ cut ─▶ stretch ─▶ gain ─▶ fade ─▶ [ the stack, in order ] ─▶ out
```

Read it as a sentence:

> The **region** says *what audio*. The **edit stack** says *how it sounds*.

The region is cut first. The track's stack then processes that cut, and only
that cut. This is how a DAW routes a clip: clip gain and clip fades come first,
the track's plugin chain comes after.

SoundSlice differs from a DAW in one way that matters. A DAW exports the whole
timeline as one file. SoundSlice exports **one file per region**, so the track's
stack runs once per region, on that region's audio alone.

---

## 2. The types

```ts
/** One reversible change on a track's stack. Order is its position in the array. */
type Operation =
  | { op: "noiseReduction"; amount: number; profile: NoiseProfile }
  | { op: "eq"; bands: EqBand[] }
  | { op: "compressor"; thresholdDb: number; ratio: number; kneeDb: number;
      attackMs: number; releaseMs: number }
  | { op: "gain"; db: number }
  | { op: "loudness"; targetLufs: number }
  | { op: "peakNormalization"; targetDbfs: number }
  | { op: "limiter"; ceilingDb: number };

type EqBand = {
  type: BiquadFilterType;       // the Web Audio names, unchanged
  hz: number;
  db: number;
  q: number;
};

/** A frequency measurement taken once, from a region the user marks as silent. */
type NoiseProfile = { id: string; magnitudes: Float32Array; fftSize: number };

/** The ordered list of operations held against a track. */
type EditStack = Operation[];

/** What a region owns. Times are in the *source file's* seconds, always. */
type Region = {
  id: string;
  start: number;
  end: number;
  gainDb: number;                                  // stacks with the track's gain
  fade: { inMs: number; outMs: number };
  stretch?: { rate: number; semitones: number };
};

type Track = {
  file: File;
  stack: EditStack;
  regions: Region[];
};
```

`Operation` is a discriminated union on `op`. That one field carries the type,
the serialised name, and the switch in the graph builder. There is no separate
registry to keep in step.

---

## 3. The operation set

Nine things change the sound. Seven live on the track's stack. Two are region
properties, because in every DAW they are clip properties.

| Operation | Carries | Built from | Two passes? |
|---|---|---|---|
| Noise reduction | amount, noise profile | `AudioWorklet` | the profile only |
| EQ | bands | `BiquadFilterNode` chain | no |
| Compressor | threshold, ratio, knee, attack, release | `DynamicsCompressorNode` | no |
| Gain | dB | `GainNode` | no |
| Loudness | target LUFS | measuring `AudioWorklet`, then `GainNode` | **yes** |
| Peak normalization | target dBFS | measuring `AudioWorklet`, then `GainNode` | **yes** |
| Limiter | ceiling dB | `DynamicsCompressorNode` | no |
| **Fade edges** | in ms, out ms | `GainNode` envelope | no — region |
| **Time and pitch** | rate, semitones | `AudioWorklet` | no — region |

Where Web Audio already has a node, use that node. It runs off the main thread,
it is fast, and it is somebody else's bug. Reach for an `AudioWorklet` only
where Web Audio has nothing.

**Today's compressor keeps its exact sound**, because it is still
`DynamicsCompressorNode` with the same numbers: threshold −8 dB, ratio 4, knee 0,
attack 8 ms, release 50 ms (`audio-processors.ts:52`). The limiter likewise:
threshold −0.95 dB, ratio 20, knee 0, attack 3 ms, release 50 ms.

### Three things that look like operations and are not

| Your feature | What it really is |
|---|---|
| Many regions, split on silence, snap to transients | **region tools.** They make and move regions. They do not change sound, so they are not on the stack. |
| FLAC, Opus, bit depth, sample rate | **output choices.** They happen after the graph has finished. |
| Join with crossfades | **an output choice.** It combines regions that are already rendered. |
| Saved projects, copy settings to all tracks | **workspace.** They move stacks about; they are not in one. |

### Fade edges is now a real control

Today a 20 ms linear fade is applied to every slice and cannot be switched off
(`audio-trimmer.ts:28`). It becomes **Fade edges**, defaulting to 20 ms in and
20 ms out, linear. Simple view keeps the default and does not show it. This is
what makes "the region is the trim" safe — see section 4.

---

## 4. What a region owns

**Trim is not an operation.** The ticket listed it as one. `CONTEXT.md` gave "a
trim" as an example operation. Both are now corrected.

The region's `start` and `end` already say which audio you want. Making that an
operation as well means two places hold one fact, and they can disagree.

A region owns exactly three things:

| Region property | Why it is not on the track |
|---|---|
| **Gain** | one clip was recorded quieter than the others |
| **Fade edges** | a fade belongs to an edge, and only a region has edges |
| **Time and pitch** | in a DAW you stretch a clip, not a track |

Everything else is a track effect and every region inherits it. A noise profile
describes a microphone and a room, not one clip. An EQ curve fixes a voice, not
a moment.

**Per-moment control is not in this wave.** When it is wanted, the answer is an
**envelope** — a setting that changes over time — added to any exposed setting.
That is deliberately not a region concern, and it is on the map's fog.

### Region gain stacks, it does not replace

```
you hear  =  track gain (dB)  +  region gain (dB)
```

Set the track to −1.9 dB and region 3 to +3.5 dB, and region 3 comes out at
+1.6 dB. Turn the whole track down later and every region keeps its relative
balance.

This is not a rule the engine enforces. It is what two `GainNode`s in series
already do. It is also clip gain in every DAW.

### Region times never move

`start` and `end` are always in the **source file's** seconds. Time and pitch
happens *after* the cut, so stretching a region to half speed does not move any
mark. Nothing is ever rescaled behind the user's back.

---

## 5. Order

**Simple view uses a fixed canonical order. Advanced view may reorder freely.**

The canonical order, top to bottom:

```
   region:  cut → stretch → gain → fade
    track:  noise reduction → EQ → compressor → gain → loudness
            → peak normalization → limiter
```

It is not arbitrary. Noise reduction goes early, before anything changes the
level its profile was measured against. Everything that changes level sits above
loudness, because loudness measures what it is handed. The limiter is last,
because it is the safety net.

**Nothing is pinned, and nothing is warned about.** An Advanced user may put the
limiter first and clip their own export. That was decided in grilling: the
operating assumption for Advanced view is that the user knows what they are
doing. Simple view never reorders, so it never gets the chance.

**The limiter may also be switched off** in Advanced view. Simple view keeps it
on and last, always. This settles the contradiction in
[013 — Post-processing switch does nothing unless normalize is on](../tickets/013-post-processing-guard-defect.md):
`limit()` is on by default, not unconditional, and it is applied whenever it is
in the stack — not only when normalize happens to be on.

### Loudness and peak normalization together

Both compute a gain. If both are on, the second one throws away the first one's
target. **That is allowed, and order decides.** No special case, no warning.

Two gain stages in series is exactly what the graph already does. Adding a
mutual-exclusion rule would fight the model, and it would get ugly when the two
sit at different points in a reordered stack.

### Switching to Simple keeps a reordered stack

Simple view cannot show the order or change it. It still **renders** whatever
order is set, because ticket 003 forbids a view change from changing the audio.
A non-canonical order counts as one Advanced setting on the chip.

---

## 6. The render path

**One graph, built once, rendered by an `OfflineAudioContext`.**

```
buildGraph(context, track, region)   ← one function, one implementation
        │
        ├──▶ new AudioContext(…)              → what you hear
        └──▶ new OfflineAudioContext(…)       → what you export
```

Both contexts run the same nodes with the same settings at the same 128-sample
block size. **They cannot disagree, because they are the same graph.**

### The measurements this rests on

Every claim below was run in Chromium 146, not assumed.

| Question | Answer |
|---|---|
| Does an `AudioWorklet` run inside an `OfflineAudioContext`? | **yes** — 22000 of 22500 blocks reported |
| Can it sit in one graph beside a built-in node? | **yes** — beside a `DynamicsCompressorNode` |
| Does that render block the main thread? | **no** — 14 frames drawn, longest freeze 17 ms |
| Can it report progress from inside the render? | **yes** — 11 messages in one render |
| How fast? | 60 s of audio in **209 ms**, about 287× real time |
| Same block size live and offline? | **yes** — 128 samples in both |

### Web Audio was never what froze the page

The ticket assumed the current code renders once per effect, N full passes, and
that this is the cost. It is not. Probing the main thread with
`requestAnimationFrame` while each stage ran, on `track-5m.mp3`:

| Stage | Took | Frames drawn | Verdict |
|---|---|---|---|
| Decode | 1129 ms | 67 | free |
| **`AudioTrimmer.trimAudio`** | 454 ms | **0** | **frozen solid** |
| Effects — four `OfflineAudioContext` renders | 1741 ms | 103 | free |
| Whole slice | 3880 ms | 202 | one 432 ms freeze, from the trim |

`OfflineAudioContext` already renders off the main thread. The freeze is
`AudioTrimmer.trimAudio`, a plain loop over every sample.

**So writing our own DSP would have made this worse, not better** — unless it ran
in a worker, and Web Audio cannot run in a worker at all. The whole API is
`[Exposed=Window]`; `OfflineAudioContext` is `undefined` inside one.

`AudioTrimmer.trimAudio` and `getMaxAmplitude` are both deleted by ticket 008.
The cut becomes `AudioBufferSourceNode.start(0, offset, duration)`. The fade
becomes a `GainNode` envelope. Neither is a loop.

### Two passes, when a measurement is needed

Loudness and peak normalization cannot know their gain until they have seen the
whole region. So:

1. **Pass 1** renders the graph truncated at the measuring operation. Its worklet
   reports one number.
2. **Pass 2** renders the whole graph with that gain in place.

At 287× real time a second pass on a 5-minute region costs roughly one second.
When neither operation is present there is one pass.

### Progress

A small progress worklet always sits at the tail of the graph. It counts blocks
and posts the count through its port. That is how a long render reports
progress, which ticket 007 listed as an open problem needing chunked rendering.
It does not.

### Cancellation is not solved here

Dropping the reference to an `OfflineAudioContext` leaves it rendering to
completion, wasting the work. `suspend(time)` exists and is awkward. This belongs
to [007 — Design the worker boundary](../tickets/007-design-the-worker-boundary.md),
along with the memory ceiling.

---

## 7. The preview path

**The same `buildGraph`, given a live `AudioContext`.**

Every operation previews. There is no operation that only works on export.

| Where preview still differs | Why |
|---|---|
| Play from the middle and the first moment settles differently | compressors and EQ have memory; every DAW behaves this way |
| Loudness is briefly stale after an edit | it uses the last completed measurement; playback continues, the number updates when the new pass finishes |
| Time and pitch, and noise reduction, arrive slightly late | both need a large window; the samples are identical, they are just delayed |

### The Preview effects switch

One switch, on by default. Switch it **off** and you hear the cut with the
region's gain and fades only — the track's whole stack is bypassed.

This is the only sanctioned way for preview to differ from export, and the user
asks for it explicitly. It is not a silent degradation, and it is not per
operation. It exists because hearing the raw cut is a real thing to want, and
because a slow machine may stutter on time and pitch.

**If playback stutters, say so. Never quietly change the sound.**

---

## 8. Undo

**A command history. One entry per gesture, not per value change.**

Dragging an EQ slider is one entry, however many values it passed through.
Entries coalesce while the mouse is down.

- **One history for the whole project**, not one per track. "Clear Advanced
  settings" touches every track at once, and per-track history could not express
  it.
- **Undo scrolls to what it changed.** One history means undo can act on a card
  that is off screen. The screen moves so the user sees it happen.

An entry records what changed and how to put it back. It is not "pop the last
operation" — editing an EQ band is an edit, not an addition.

---

## 9. Serialisation

For saved projects. The stack's order is now free, so order must be stored.

```json
{
  "v": 1,
  "tracks": [{
    "file": { "name": "interview.wav", "size": 48291234 },
    "stack": [
      { "op": "noiseReduction", "amount": 0.6, "profile": "np1" },
      { "op": "eq", "bands": [{ "type": "peaking", "hz": 240, "db": -3, "q": 1 }] },
      { "op": "loudness", "targetLufs": -14 },
      { "op": "limiter", "ceilingDb": -0.95 }
    ],
    "regions": [
      { "id": "r1", "start": 12.4, "end": 38.9, "gainDb": 3.5,
        "fade": { "inMs": 20, "outMs": 20 } }
    ]
  }]
}
```

An ordered array, one entry per operation. Position **is** the order.

**Audio is never stored.** The file name is a label. The user re-opens the file.
That is standing policy: audio never leaves the browser, and it is not kept in it
either.

**An unknown `v`, or any unknown `op`, discards the whole project.** It is not
skipped and it is not migrated. Loading three operations out of four would give
silently different audio from the same project file, which breaks the one promise
this design is built on. `soundslice:view` and `soundslice:master-defaults`
already work this way, per ticket 003.

---

## 10. Sample rate

**The export context is created at the source file's own rate.**

Today nobody chooses. `decodeAudioData` resamples to the `AudioContext`'s rate,
and that rate follows the audio hardware. Baselines finding 3: all six test files
are 44.1 kHz on disk, and all six decoded to 48 kHz. **The same file on two
machines produces different bytes**, which breaks standing rule 1.

Because this design creates its own `OfflineAudioContext`, it can name the rate.
A 44.1 kHz file now exports at 44.1 kHz on every machine.

**This changes exported bytes for existing users.** On a 48 kHz machine, a
44.1 kHz source used to come out at 48 kHz. It will now come out at 44.1 kHz.
That is a fix, not a regression: it never resamples unless asked.

[011 — WebCodecs encoder path with fallback](../tickets/011-webcodecs-encoder-path.md)
later adds a rate the user may choose. This is only the default.

---

## 11. What this changes about today

| Today | After |
|---|---|
| `applyProcessingPipeline` runs a hard-coded list, one full render per effect | one graph, one render, order stored on the track |
| `AudioTrimmer.trimAudio` loops over every sample, freezing the page 454 ms | `AudioBufferSourceNode.start(0, offset, duration)` |
| the 20 ms fade is forced and invisible | **Fade edges**, a region property, 20 ms default |
| `getMaxAmplitude` loops over every sample on the main thread | a measuring worklet |
| `limit()` is marked always-on and is not always applied | on by default, in the stack, and actually applied |
| nothing is recorded, so there is no undo | the stack is the record; undo is a command history |
| output follows the machine's sample rate | output follows the file's |
| there is no preview at all | the same graph, in a live `AudioContext` |

---

## 12. What this does not answer

- **The memory ceiling.** An `OfflineAudioContext` allocates its whole output up
  front. A 45-minute stereo track is about 476 MB. Ticket 007 owns this, and must
  also count the blob URL that ticket 015 found.
- **Cancellation.** Ticket 007.
- **The join strip.** Crossfades between regions from any track produce one file.
  That is an output stage after this graph, and it is still fog.
- **Which settings "copy to all tracks" copies.** Now answerable, because the
  operation set is named. Still needs deciding.

---

## What ticket 008 can now assume

- One `buildGraph(context, track, region)`. A live `AudioContext` previews it, an
  `OfflineAudioContext` exports it. Never two implementations.
- Built-in nodes wherever Web Audio has one. `AudioWorklet` only for noise
  reduction, time and pitch, loudness measurement, and progress.
- The DSP inside each worklet is a plain function over `Float32Array`, so Vitest
  can test it in Node with no browser. That answers ticket 006's open question.
- The region is cut first, by `AudioBufferSourceNode.start(0, offset, duration)`.
  No sample loop survives.
- Region times are in the source file's seconds and never move.
- Region gain stacks with track gain. It does not replace it.
- Two render passes when loudness or peak normalization is present. One otherwise.
- Nothing runs on the main thread.
