# 008 — Build the edit stack and rewrite the engine

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** claude
**Blocked by:** none — was [007](./007-design-the-worker-boundary.md), [002](./002-design-the-edit-stack.md), [006](./006-install-vitest.md) and [013](./013-post-processing-guard-defect.md), all closed 2026-08-19
**Blocks:** [010 — Build LUFS normalization with tests](./010-build-lufs-normalization.md), [011 — WebCodecs encoder path with fallback](./011-webcodecs-encoder-path.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can the whole engine be rewritten onto the edit stack, with no loss of function
and no loss of speed?

This is the spine of the map. It builds the design from ticket 002, inside the
worker boundary from ticket 007, and holds itself to the baselines from ticket
001.

The work:

1. Build the operation types and the stack, per the design in ticket 002.
2. Build the render path — replay a stack into audio.
3. Build the live preview path — the same stack as a live `AudioContext` graph.
4. Rewrite `src/lib/audio-service.ts`, `src/lib/audio-trimmer.ts` and
   `src/lib/audio-processors.ts` onto it. The old functions become operations.
5. Keep Simple view working the whole way. It must produce the same output as
   before, for the same settings.
6. Add DSP tests for each operation.

**Defects fixed by this ticket** (two of the three on the map):

- `trimSilence()` at `src/lib/audio-processors.ts:185` reads the analyser before
  the offline render runs, so it reads zeros. It cannot work as written. Its
  toggle is already commented out at
  `src/components/custom/MasterToolbar.tsx:127`. It is redesigned as region
  detection in a later feature ticket. Remove the broken version here.
- Double decoding. `AudioEditor` decodes via `audioService.loadFile`, then
  `AudioService.sliceAudio` decodes the same file again at
  `src/lib/audio-service.ts:53`. One decode per track.

## Acceptance

Every baseline number from ticket 001 is matched or beaten, on the same machine
and browser. Record the new numbers beside the old ones.

If any Simple-path number is worse, this ticket is not done. Standing rule 4 has
no exceptions for the Simple path.

---

## Resolution — 2026-08-19

**Built.** The engine is the edit stack. Every baseline number is beaten, and
the acceptance that was not a number — a 45-minute track surviving repeated
export — passes.

### The answer to the question

> Can the whole engine be rewritten onto the edit stack, with no loss of
> function and no loss of speed?

Yes, and it is faster everywhere. See
[`baselines.md`](../baselines.md)'s "the engine rewrite" addendum for every
number.

| Case | Best previous | Now |
|---|---|---|
| Decode, 5-minute MP3 | 1262.7 | **556.7** |
| Slice, switches off, 5-minute MP3 | 2329.2 | **1494.2** |
| Slice, processed, 5-minute MP3 | 3632.9 | **2836.9** |
| Export MP3, 5-minute | 3931.3 | **3234.4** |
| Batch, 10 × 30-second | 2350 | **1525.2** |
| Time to first waveform | 689 | **631** |
| Simple bundle, gzip | 136.62 KiB | **111.95 KiB** |

`podcast-45m.mp3` now exports three times in a row — 13022.2, 13024.8 and
13258.7 ms — where the baseline sweep killed the tab on the second run.

### What was built

| Module | What it is |
|---|---|
| `src/lib/edit-stack.ts` | the seven operations, the region, the canonical order, Simple view's preset |
| `src/lib/graph.ts` | **one** `buildGraph(context, plan)`, for both contexts |
| `src/lib/render.ts` | the offline path, measuring passes, progress, cancellation |
| `src/lib/preview.ts` | the live path, over the same `buildGraph` |
| `src/lib/encode-worker.ts` | one worker, the protocol, chunked and cancellable |
| `src/lib/encoder.ts` | the main-thread half; transfer, ids, cancel |
| `src/lib/audio-format.ts` | reads a file's own sample rate from its header |
| `src/lib/memory-ceiling.ts` | the 1 GB rule |
| `src/lib/file-names.ts` | output names, and the collision below |
| `src/lib/download.ts` | the only place an export blob URL is made, and it is revoked |

Deleted: `audio-trimmer.ts`, `audio-processors.ts`, `audio-worker.ts`. With them
went `trimAudio`, `getMaxAmplitude`, `sliceAudioViaWorklet`, `trimSilence` and
`applyProcessingPipeline` — every one named by this ticket or by the designs.

`pnpm test` is 10 → **89 tests**.

### Both named defects are fixed

- **`trimSilence` is gone.** It read an `AnalyserNode` before the offline render
  ran, so it read zeros. Its master default and its persisted key went with it,
  which is why `MASTER_DEFAULTS_STORAGE_VERSION` is now 2. A stored version 1
  value is discarded, not migrated, so a user's two switches reset once.
- **One decode per export.** `AudioLoader.loadAudioFile` also stopped rendering
  its result through a pointless `OfflineAudioContext` — baselines finding 4.
  That alone is most of the decode win: 836.5 → 223.2 ms on `track-5m.wav`.

### Four things this ticket found and fixed on the way

**1. The progress worklet leaked the entire render.**

Ticket 002 measured an `AudioWorklet` at the tail of the graph counting blocks,
and settled on it. It was built, it worked, and every finished render stayed in
memory. Thirty renders of `clip-30s.wav`, 302.8 MB of output:

| | RSS growth | ms per render |
|---|---|---|
| no progress | +10.3 MB | 61.0 |
| worklet | **+322.8 MB** | 80.6 |
| worklet, port closed and node disconnected | **+316.4 MB** | — |
| `suspend()` and `resume()` | **−4.3 MB** | 63.8 |

Closing the `MessagePort` did not help, so the port was not the root. Calling
`audioWorklet.addModule` on an `OfflineAudioContext` keeps that context alive,
and the context holds the buffer it rendered. **There is no API to release it:
`OfflineAudioContext` has no `close()`, and its state reads `"closed"` the
moment rendering finishes.**

Progress is now `suspend(time)` and `resume()`, nineteen points per pass. The
edit stack design called `suspend` "awkward" — it was weighing it for
cancellation, where it is. For progress it is nineteen promises.

**This is a correction to ticket 002's design.** `designs/edit-stack.md` section
6 still names the worklet; it was right that a worklet *can* report progress from
inside an offline render, and wrong that it should.

**2. A 605 KB ID3 tag made a 44.1 kHz file decode at 11025 Hz.**

The new sample-rate sniffer reads 64 KB of header. `bench-audio/clip-30s.mp3`
carries **605216 bytes of ID3** for its album art, so the first frame header sits
ten windows in. The first version fell back to scanning from offset 10 — inside
the artwork — found eleven set bits that looked like a frame header, and reported
11025 Hz. The whole file then decoded at a quarter of its rate.

Fixed three ways, and all three matter:

- The sniffer **gives up** rather than guessing when the tag runs past its bytes.
- A candidate is confirmed by finding a **second** frame header exactly one frame
  later. Eleven set bits appear in random data every couple of kilobytes.
- `AudioLoader` takes a second look past the tag, which is where the answer is.

All six benchmark files now read 44100 Hz, which is what `baselines.md` says is
on disk.

**3. MP3 export at the file's own rate can be an illegal configuration.**

`shine.js` accepts nine sample rates and answers "Invalid configuration" for
anything else. 320 kbps is an MPEG-1 bitrate and MPEG-1 stops at 32 kHz, so a
22 kHz source at 320 kbps encodes nothing at all.

This could never fire before: every buffer arrived at the machine's rate.
Decoding at the file's own rate opened it. So MP3 export now resamples to the
nearest rate MP3 allows, and picks 160 kbps below 32 kHz. Nothing that worked
before changes — every rate in the benchmark set is already legal, and every one
of them keeps 320 kbps.

**4. A three-track export produced a two-file zip.**

`clip-30s.wav` and `clip-30s.mp3` both export as `sliced_clip-30s.wav`, and
`zip.file()` overwrites without a word. The old `getNewFileName` had the same
hole; nothing had ever looked inside the zip. Names are now made unique —
`sliced_clip-30s (2).wav` — with tests.

Two smaller ones fell out of the same look: the zip download had **no file name
at all** (the `<a>` carried no `download` attribute, so the browser named it from
the blob URL), and a single-track download had **no extension**. Both fixed.

### Where this departs from the designs, and why

**Simple view's stack is not the canonical order.** With both switches on it is
`peakNormalization → compressor → peakNormalization → limiter`. The doubled
normalization is deliberate: the first one is input gain staging, lifting a quiet
recording to the compressor's −8 dB threshold so the compressor engages at all.
Sort it canonically and "Apply Post Processing? Yes" does nothing on a quiet
file, which is a loss of function this ticket forbids.

**The canonical order has no level-setting slot before the compressor.** That is
a hole in `designs/edit-stack.md`, now recorded there. Adding a slot is a design
decision, not a build one, so it is on the map's fog.

**The worker returns a `Blob`, not a URL**, and it gained a third request,
`measure`. Both are recorded in `designs/worker-boundary.md` section 2. The first
closes ticket 018; the second keeps a 260-million-sample peak scan off the main
thread.

### What is typed and not built

Named here so nothing looks finished that is not:

- **`loudness`** is in the `Operation` union and `graph.ts` throws for it, naming
  ticket 010. Measuring LUFS is that ticket's whole job.
- **`noiseReduction`** likewise. It needs an `AudioWorklet` and a noise profile,
  and it has no control.
- **Time and pitch** (`Region.stretch`) is typed and unbuilt for the same reason.

A stack is serialised by operation name, so a name in the union with no builder
fails loudly at export. A name missing from the union would fail silently, which
is why all seven are typed.

### What this ticket did not do

**The card's play button still drives wavesurfer.** `src/lib/preview.ts` is the
preview path, it shares `buildGraph`, and nothing calls it. Moving playback off
wavesurfer's `<audio>` element onto a Web Audio graph means re-doing the
playhead, the scroll, and region-out handling — that is the Preview feature's
work, not the engine rewrite's. Raised as
[019 — Wire preview onto the edit stack](./019-wire-preview-onto-the-edit-stack.md).

**Cancellation is built and never called.** `renderRegion` takes `isCancelled`
and the encoder takes `cancel(id)`; an in-flight 5-minute MP3 encode abandons in
**76.5 ms**. Nothing in the UI can cancel an export yet, because there is no
button. That belongs to whichever ticket adds one.

### Verified in the browser, production build

Three files loaded, one region dragged from 01:39 to 00:13, then "Slice All
Files":

- progress read "File 1 of 3 — applying effects 95%", "File 2 of 3 — encoding
  100%", and so on
- the download was `sliced-audio.zip`, holding **three** files at 44100 Hz, with
  durations 29.000, 29.000 and 13.178 seconds
- after the export: **three cards, regions intact**, including the dragged one
- a single-track download gave `trimmed_clip-30s.wav`

Three 454.2 MB files dropped together: two accepted, the third refused with
"SoundSlice holds 1.0 GB of audio at once and is now holding 908.4 MB. Nothing
already loaded was removed."

### Acceptance

Met. Every median in `baselines.md` is matched or beaten on the same machine and
browser, and the new numbers sit beside the old ones there. No Simple-path number
is worse.
