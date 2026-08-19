# 007 — Design the worker boundary

**Type:** `wayfinder:grilling`
**Status:** closed
**Assignee:** claude
**Blocked by:** none
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What runs on the main thread, what runs in a worker, and how do they talk?

> **Three of these seven are already answered**, by
> [002 — Design the edit stack](./002-design-the-edit-stack.md), design at
> [`designs/edit-stack.md`](../designs/edit-stack.md). Do not redo them.
>
> - **Question 1, the split.** Nothing runs on the main thread. The whole edit
>   stack is one Web Audio graph, and `OfflineAudioContext` already renders it off
>   the main thread — measured, 103 frames drawn during 1741 ms of effects. The
>   freeze was `AudioTrimmer.trimAudio`, our own sample loop, which is deleted.
> - **Question 4, progress.** Solved, and chunked rendering is not needed. An
>   `AudioWorklet` at the tail of the graph counts blocks and posts the count.
>   Measured: 11 messages during one offline render.
> - **Question 7, `AudioWorklet`.** Yes, and it is load-bearing. Noise reduction,
>   time and pitch, loudness measurement and progress are all worklets. Verified
>   that a worklet runs inside an `OfflineAudioContext`, beside a built-in node,
>   at the same 128-sample block size as a live `AudioContext`.
>
> **Still open: questions 2, 3, 5 and 6** — transfer cost, worker lifetime,
> cancellation, and the memory ceiling. Those are the real remaining work.

Standing rule 7 says anything over 300 ms shows progress and runs in a worker.
Advanced view adds noise reduction, time-stretch, and FFT work. Those will
freeze the UI if this is settled wrong.

Today only encoding runs in a worker. `src/lib/audio-trimmer.ts:64` spawns a
fresh `AudioWorker` per export and copies every channel's `Float32Array` into
the message. Decoding, trimming, and all effects run on the main thread.

Decide:

1. **The split.** Which stages move into the worker? Decode, replay of the edit
   stack, effects, encode.

   **Correction, 2026-08-18.** This ticket used to say `OfflineAudioContext` is
   available in workers. It is not. The whole Web Audio API is `[Exposed=Window]`.
   Measured in Chromium 146 inside a dedicated worker:

   | Global | In a worker |
   |---|---|
   | `OfflineAudioContext` | `undefined` |
   | `AudioContext` | `undefined` |
   | `AudioBuffer` | `undefined` |
   | `AudioEncoder` | `function` |
   | `AudioData` | `function` |

   So **no Web Audio node graph can run off the main thread.** Any stage moved
   into a worker must be rewritten as plain arithmetic over `Float32Array`.
   Encoding can stay in a worker, because WebCodecs is exposed there.

   This changes the shape of the answer. The question is no longer "which stages
   move", it is "which stages can be expressed without Web Audio at all". See
   the [WebCodecs research](../research/webcodecs-audioencoder.md) on the
   `research/webcodecs-audioencoder` branch.
2. **Transfer cost.** Channel data is currently copied, not transferred. A
   45-minute stereo track at 48 kHz is roughly 1 GB as `Float32Array`. Decide
   between transferable `ArrayBuffer`, `SharedArrayBuffer`, or chunking. Note
   that `SharedArrayBuffer` needs cross-origin isolation headers, which
   `gh-pages` may not allow — check this.
3. **Worker lifetime.** One worker per export, as today, or a pooled worker per
   track, or one shared pool. Spawning a worker costs time.
4. **Progress.** How a long render reports progress back. `OfflineAudioContext`
   gives no progress events, so chunked rendering may be required.
5. **Cancellation.** The user changes a slider mid-render. How is the in-flight
   render abandoned without leaking a worker?
6. **Memory ceiling.** How many decoded tracks are held at once. Ten 45-minute
   tracks will not fit. Decide the eviction rule, or the chunking rule.

   Note that a loaded track also costs its **encoded** file, not only its decoded
   buffer: `AudioEditor` creates a blob URL and never revokes it. See
   [015 — Track audio is never released](./015-release-track-audio.md). The
   ceiling has to count both.

   **Measured 2026-08-19, by [015](./015-release-track-audio.md), now closed.**
   Ten `track-5m.wav` Files, 50.4 MB each, held only by their blob URLs. Chromium
   RSS read from `/proc`, garbage collected through CDP before each reading:

   | State | Chromium RSS |
   |---|---|
   | Before | 1252.7 MB |
   | Ten blob URLs alive | 1525.6 MB |
   | The same ten revoked | 1019.7 MB |

   **A loaded track costs its whole encoded file, one for one, until its card
   unmounts.** Revoking released 505.9 MB against 503.9 MB of file data. A card
   now revokes on unmount, so the ceiling counts encoded plus decoded for every
   track **on screen**, and nothing for tracks whose cards are gone.

   There is no way to remove one track in the UI today, so "on screen" currently
   means "every track ever loaded". Whether Advanced view needs a remove control
   is a feature decision, not this ticket's.
7. **AudioWorklet.** Whether live preview needs an `AudioWorklet` for anything,
   or whether built-in nodes cover it. Note the empty stub at
   `src/lib/audio-service.ts:34`, `sliceAudioViaWorklet`, which returns `null`.

## Answer format

A written design, committed to `.wayfinder/designs/worker-boundary.md`. It must
state the message protocol, the transfer strategy, and the memory ceiling as a
number.

This ticket has a hard constraint from the map: Simple view must not get slower.
Moving work into a worker adds transfer cost. If the split makes Simple slower,
the split is wrong.

---

## Resolution — 2026-08-19

**Answered.** The design is
[`designs/worker-boundary.md`](../designs/worker-boundary.md), grilled and agreed.

The ticket asked which stages move into a worker. That question was already dead
before this session: Web Audio is `[Exposed=Window]`. What was left is narrow,
and all four remaining questions are settled.

### The five decisions

| # | Decision |
|---|---|
| 1 | **The worker encodes, and nothing else.** Decode, graph and render all stay on the main thread, because they cannot go anywhere else. Decode was never a freeze: 1129 ms, 67 frames drawn. |
| 2 | **PCM is transferred, never shared.** `SharedArrayBuffer` needs COOP and COEP headers, and GitHub Pages sets no custom headers. Transfer also halves peak memory: a 45-minute stereo track is 1.04 GB, and copying makes 2.08 GB exist at once. |
| 3 | **One encode worker, for the life of the page.** A pool was rejected: the step in front of encoding is serial whatever the worker does, and a pool of *K* multiplies peak memory by *K*. |
| 4 | **Cancel abandons the result, it does not stop the render.** A generation number rides with each render; a stale result is dropped and its URL revoked. |
| 5 | **1 GB of encoded audio, and no decoded buffer is ever cached.** A drop that would cross the line is refused, with the reason shown. Nothing is evicted behind the user's back. |

**The export stays serial.** Overlapping the encode of file *N* with the render
of file *N+1* is possible with one worker and no pool. It is deliberately not
built: it doubles peak memory to save a share of the work nobody has measured.

### The safety rule the transfer decision costs

Transferring `AudioBuffer.getChannelData(i).buffer` **detaches the whole
`AudioBuffer`**. A later read throws `Cannot perform Construct on a detached
ArrayBuffer`.

So: transfer only the freshly rendered export buffer, never a buffer anything
else still reads. That is safe here precisely because section 6 caches nothing.

### One wrinkle the grilling created

Ruling out `SharedArrayBuffer` also ruled out a flag readable mid-loop. A busy
worker reads its inbox only when it yields.

So the encoder chunks its work and yields between chunks. The cost is one
macrotask per chunk, and it is **not measured**. Chunk size is ticket 008's to
pick, with a measurement rather than a guess.

### Found in the code while writing this

- `sliceAllFilesIntoZip` is serial. It awaits each file inside a `for` loop.
- `new AudioWorker()` runs once per file per export, and `terminate()` appears
  nowhere in `src/`. Ten files spawn ten workers and leak all ten.
- Channel data is copied. That `postMessage` carries no transfer list.
- Nothing caches a decoded buffer, and `AudioLoader.loadAudioFile` decodes
  **twice** — once through an `AudioContext`, then again through a pointless
  `OfflineAudioContext` render.
- **Two blob URLs per export are never revoked** — the encoded output and the
  zip. Roughly 74 MB leaked per ten-file WAV export, and again on every repeat.
  That is a seventh defect, now
  [018 — Export blob URLs are never revoked](./018-revoke-export-blob-urls.md).
  It does not block ticket 008, which rewrites both files anyway.

### What is still unmeasured

Every "not worth it" in this design rests on one missing number: the encode share
of a slice. One browser run would give it. The chunk-size cost and wavesurfer's
own per-card memory are also unmeasured, and both are named in the design.

Ticket 008 is unblocked.
