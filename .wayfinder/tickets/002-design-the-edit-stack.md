# 002 — Design the edit stack

**Type:** `wayfinder:grilling`
**Status:** closed
**Assignee:** agent session 2026-08-18 (edit stack design)
**Blocked by:** none
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md), [013 — Post-processing switch does nothing unless normalize is on](./013-post-processing-guard-defect.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What is an operation, and how does replaying a stack of them produce audio?

The edit stack is the spine of this map. Every feature writes to it. Get it
wrong and every later ticket pays.

Today `sliceAudio` decodes, trims, then pipes the buffer through
`applyProcessingPipeline`, which runs a fixed list of effects. The order is
hard-coded in `src/lib/audio-processors.ts:331`. There is no undo and no record
of what was applied.

Decide:

1. **The operation set.** What operations exist? Trim, fade, gain, EQ, loudness,
   compress, noise reduction, time-stretch — what else, and what does each carry?
2. **Order.** Is the stack user-ordered, or does it always render in a fixed
   canonical order? Some orders are wrong: normalizing after limiting is
   pointless. Does the user get to make that mistake?
3. **Replay.** One `OfflineAudioContext` graph, or a chain of renders? The
   current code renders once per effect, which means N full passes.
4. **Region and stack.** Does a region own a stack, or does a track? Advanced
   view allows many regions per track. Can two regions of one track have
   different EQ?
5. **Live preview.** The same stack must build a live `AudioContext` graph for
   preview. Which operations can preview live, and which cannot? Time-stretch
   and noise reduction may not.
6. **Serialisation.** The stack must survive being written to storage later, for
   saved projects. What shape does it take on disk?
7. **Undo.** Is undo "pop the last operation", or a separate command history?
   Changing an EQ slider should not push a hundred entries.

## Answer format

A written design, committed to `.wayfinder/designs/edit-stack.md`. It must name
the types, the render path, and the preview path. It must state which operations
are preview-capable.

Also record whether this needs an ADR. It is hard to reverse, surprising without
context, and the result of a real trade-off — so it probably does.

---

## Resolution — 2026-08-19

The design is [`designs/edit-stack.md`](../designs/edit-stack.md). It answers all
seven questions. Eighteen decisions were settled in grilling.

**Yes, it needs an ADR**, and there is one:
[`docs/adr/0001-one-graph-two-contexts.md`](../../docs/adr/0001-one-graph-two-contexts.md).
It is the repo's first, so it created `docs/adr/`.

### The seven questions

| # | Question | Answer |
|---|---|---|
| 1 | The operation set | Seven operations on the track's stack, two more on the region. Region tools, output choices and workspace features are **not** operations. |
| 2 | Order | A canonical order, fixed in Simple view. Advanced view reorders freely, with nothing pinned and no warnings. |
| 3 | Replay | **One graph, built once.** Not a chain of renders. Two passes only when a measuring operation is present. |
| 4 | Region or track | The **track** owns the effects. A region owns gain, fade edges, and time and pitch. |
| 5 | Live preview | **Everything previews.** The same graph in a live `AudioContext`. One "Preview effects" switch bypasses the track's effects. |
| 6 | Serialisation | An ordered array of `{ op, … }`. Position is the order. Unknown version or unknown `op` discards the project. |
| 7 | Undo | A command history. One entry per gesture, one history for the project, and it scrolls to what it changed. |

### The four answers that reverse the ticket

**1. Trim is not an operation.** The ticket listed it first. The region's start
and end already say which audio you want, so making it an operation too puts one
fact in two places. `CONTEXT.md` said "such as a trim" and has been corrected.

This is only safe because **Fade edges** becomes a real control. Today a 20 ms
fade is forced and invisible at `audio-trimmer.ts:28`.

**2. The engine is one Web Audio graph, played two ways.** A live `AudioContext`
previews it; an `OfflineAudioContext` exports it. Same nodes, same 128-sample
blocks, so preview and export cannot disagree. `AudioWorklet` fills the gaps
Web Audio leaves — noise reduction, time and pitch, loudness measurement,
progress.

The user rejected an earlier framing where preview was allowed to be
approximate. That rejection produced a better answer than any option offered.

**3. Web Audio was never what froze the page.** The ticket's premise was that
rendering once per effect is the cost. Probing the main thread with
`requestAnimationFrame` during a 5-minute export:

| Stage | Took | Frames drawn |
|---|---|---|
| Decode | 1129 ms | 67 |
| **`AudioTrimmer.trimAudio`** | 454 ms | **0** |
| Four `OfflineAudioContext` renders | 1741 ms | 103 |

`OfflineAudioContext` already renders off the main thread. Our own sample loop is
what froze it. So "write our own DSP in a worker" would have made this **worse**,
and Web Audio cannot run in a worker at all.

Standing rule 7 was reworded on the map because of this. It now reads: **no audio
work runs on the main thread.**

**4. An export follows the file's sample rate, not the machine's.** Baselines
finding 3: all six test files are 44.1 kHz on disk and all six decoded to 48 kHz,
because that is what this machine's audio hardware runs at. Creating our own
`OfflineAudioContext` means naming the rate. This changes exported bytes for
existing users, and it fixes a standing rule 1 break.

### Measured before deciding

Every load-bearing claim was run in Chromium 146, not assumed.

| Question | Answer |
|---|---|
| Does an `AudioWorklet` run inside an `OfflineAudioContext`? | **yes** — 22000 of 22500 blocks reported |
| Can it sit in one graph beside a built-in node? | **yes**, beside a `DynamicsCompressorNode` |
| Does that render block the main thread? | **no** — 14 frames drawn, longest freeze 17 ms |
| Can it report progress from inside the render? | **yes** — 11 messages in one render |
| How fast? | 60 s of audio in **209 ms**, about 287× real time |
| Same block size live and offline? | **yes** — 128 samples in both |

The progress answer matters beyond this ticket. Ticket 007 listed progress as an
open problem needing chunked rendering. It does not need it.

### What this settles for other tickets

- **[013 — Post-processing switch does nothing unless normalize is on](./013-post-processing-guard-defect.md)**
  — both of its questions are answered, so it is unblocked. The limiter is on by
  default and reorderable, not unconditional. "Apply Post Processing" is the
  Compressor operation, at the numbers it already uses.
- **[006 — Install Vitest](./006-install-vitest.md)** — its open question was
  whether Web Audio can be tested under Node. It does not need to be. The maths
  inside each worklet is a plain function over `Float32Array`.
- **[007 — Design the worker boundary](./007-design-the-worker-boundary.md)** —
  the split, progress and `AudioWorklet` questions are answered. Transfer cost,
  worker lifetime, cancellation and the memory ceiling are still open.
- **[011 — WebCodecs encoder path](./011-webcodecs-encoder-path.md)** — a
  user-chosen sample rate now has a default to override.

### Vocabulary added to `CONTEXT.md`

`Preview`, `Envelope`, `Effective view`, `Chip`, `Inherited`, `Override`. The
`Operation` and `Region` entries were corrected. That clears the map's fog entry
about undefined vocabulary from ticket 003.

**Envelopes are ruled out of scope**, not fogged. They are a fifteenth feature
and the destination is the fourteen. They matter here only as a promise: because
envelopes are the future answer for per-moment control, regions never have to
become the place to put it.
