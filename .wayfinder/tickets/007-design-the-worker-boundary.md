# 007 — Design the worker boundary

**Type:** `wayfinder:grilling`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** none
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What runs on the main thread, what runs in a worker, and how do they talk?

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
