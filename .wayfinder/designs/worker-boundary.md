# Design — the worker boundary

Answer to
[007 — Design the worker boundary](../tickets/007-design-the-worker-boundary.md).
Written and grilled 2026-08-19. **Agreed.**

The ticket asked which stages move into a worker. That question is already dead.
Web Audio is `[Exposed=Window]`, so no node graph can run off the main thread.

What is left is narrow, and this design settles it:

1. **The worker encodes. Nothing else.** See [section 1](#1-the-split-in-one-picture).
2. **PCM is transferred, never shared.** See [section 3](#3-transfer-never-share).
3. **One encode worker, for the life of the page.** See [section 4](#4-worker-lifetime).
4. **Cancel abandons the result. It does not stop the work.** See [section 5](#5-cancellation).
5. **1 GB of encoded audio, and no decoded buffer is ever cached.** See
   [section 6](#6-the-memory-ceiling).

---

## 1. The split, in one picture

```
  main thread (Window)                          encode worker
  ┌────────────────────────────────────┐        ┌──────────────────┐
  │ decode ─▶ build graph ─▶ render     │        │ WAV writer       │
  │ (Web Audio, all of it)              │ ─────▶ │ shine MP3        │
  └────────────────────────────────────┘  PCM   └──────────────────┘
                                       transferred        │
                                                          ▼
                                                     blob URL
```

Everything Web Audio touches stays on the main thread, because it cannot go
anywhere else. That is measured, not assumed:

| Global | In a dedicated worker |
|---|---|
| `OfflineAudioContext` | `undefined` |
| `AudioContext` | `undefined` |
| `AudioBuffer` | `undefined` |
| `AudioEncoder` | `function` |
| `AudioData` | `function` |

The main thread does not freeze doing it. Ticket 002 measured an
`OfflineAudioContext` render: 1741 ms of effects, and 103 frames still drawn.
The only freeze was our own sample loop, and ticket 008 deletes it.

**Decode stays on the main thread too.** `decodeAudioData` is Window-only, and it
already draws 67 frames during its 1129 ms. WebCodecs `AudioDecoder` does run in
a worker, and moving decode there buys nothing that is not already free.

---

## 2. The message protocol

Two messages in, four messages out. Every message carries an `id`.

**Main thread to worker:**

```ts
type EncodeRequest = {
  action: "encode";
  id: number;                 // the generation; see section 5
  format: OutputFormat;       // "wav" | "mp3"
  fileName: string;
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  channels: Float32Array[];   // transferred, not copied
};

type CancelRequest = {
  action: "cancel";
  id: number;
};
```

**Worker to main thread:**

```ts
type EncodeProgress   = { id: number; progress: number };  // 0 to 1
type EncodeDone       = { id: number; url: string };
type EncodeCancelled  = { id: number; cancelled: true };
type EncodeFailed     = { id: number; error: string };
```

The request is sent with a transfer list:

```ts
worker.postMessage(request, request.channels.map((c) => c.buffer));
```

The worker creates the blob URL, as it does today. `URL.createObjectURL` is
exposed in a worker, and the URL it returns is valid on the main thread because
both share one origin.

**The caller owns the URL from the moment it arrives.** See
[section 6](#6-the-memory-ceiling) — nothing revokes it today, and that is a
defect, not a design.

`EncodeProgress` is optional for ticket 008. It exists in the protocol so adding
it later is not a protocol change. Progress **inside the render** is not this
worker's job — a worklet at the tail of the graph reports that, settled by
ticket 002.

---

## 3. Transfer, never share

**Transfer the rendered channel data. Never copy it, and never share it.**

Today `AudioTrimmer.createDownloadLink` posts channel data with no transfer
list, so every channel is copied. A 45-minute stereo track at 48 kHz is
1.04 GB as `Float32Array`. Copying means 2.08 GB exists for a moment.

`SharedArrayBuffer` is ruled out, and not for a technical reason. It needs
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response
headers. This app deploys to GitHub Pages, which serves static files and sets no
custom headers. The only workaround is a service worker that re-serves the page
with those headers. That is a large machine for one feature.

### The safety rule

Transferring `AudioBuffer.getChannelData(i).buffer` **detaches the whole
`AudioBuffer`**. Any later read throws `Cannot perform Construct on a detached
ArrayBuffer`.

So the rule is one line, and ticket 008 must hold it:

> **Transfer only the freshly rendered export buffer. Never a buffer anything
> else still reads.**

That is safe here because the render output goes straight to the encoder and is
never read again. It is **not** safe for a decoded track buffer, which is why
section 6 caches none.

---

## 4. Worker lifetime

**One encode worker. Created on the first export, kept for the life of the
page.**

Today `new AudioWorker()` runs once per file per export, and `terminate()` is
called nowhere in `src/`. A ten-file export spawns ten workers and leaks all ten.

A pool was considered and rejected:

- The step in front of encoding cannot be parallel at all. Web Audio is
  main-thread only, so decode and render are serial whatever the worker does.
- A pool of *K* multiplies peak memory by *K*. That fights section 6's ceiling.
- The encode share of a slice has **not been measured**. Without that number, a
  pool is a guess.

**The export stays serial.** One file finishes before the next starts, exactly as
`sliceAllFilesIntoZip` does today. Overlapping the encode of file *N* with the
render of file *N+1* is possible with one worker and no pool. It is deliberately
not built: it doubles peak memory to save an unmeasured share of the work.

If the encode share is ever measured and is large, revisit overlap **before**
revisiting a pool.

---

## 5. Cancellation

**Cancel abandons the result. It does not stop the render.**

An `OfflineAudioContext` has no stop. Dropping the reference leaves it rendering
to completion. `suspend(time)` exists and is awkward.

So each render carries a **generation number**. The store holds the current
generation. A result whose generation is stale is dropped on arrival, and its
blob URL is revoked immediately.

The CPU work is wasted. The screen is always right. That is the trade this
design accepts.

### The encoder needs to yield

The encoder *can* be stopped, and cancelling it is worth doing on a long file.

A busy worker does not see incoming messages. It reads its inbox only when it
yields. `SharedArrayBuffer` would have given a flag readable mid-loop, and
section 3 rules it out.

So the encoder chunks its work and yields between chunks:

```ts
for (const chunk of chunks) {
  encode(chunk);
  await new Promise((resolve) => setTimeout(resolve, 0));  // read the inbox
  if (cancelled.has(id)) return post({ id, cancelled: true });
}
```

The yield costs one macrotask per chunk. **That cost is not measured.** Chunk
size is ticket 008's to pick, and it should be picked with a measurement, not a
guess.

`worker.terminate()` is not used. It would kill the one long-lived worker from
section 4.

---

## 6. The memory ceiling

**1 GB of encoded audio across the loaded tracks. No decoded buffer is ever
cached.**

### What a track costs

Two halves, and both are real:

| Half | Size | Lives for |
|---|---|---|
| Encoded | the file, one for one | as long as its card is mounted |
| Decoded | `seconds × rate × channels × 4` bytes | one export, then it is dropped |

The encoded half was measured by ticket 015. Ten `track-5m.wav` files, 50.4 MB
each, held only by their blob URLs: revoking them released **505.9 MB** against
503.9 MB of file data.

The decoded half is arithmetic. A 5-minute stereo track at 48 kHz is 115.2 MB. A
45-minute one is 1.04 GB.

### The rule

- **Count the encoded bytes of every track on screen.** Cap the total at 1 GB.
- **A drop that would cross the line is refused**, and the reason is shown. No
  track is evicted behind the user's back.
- **Never cache a decoded buffer.** `AudioLoader.loadAudioFile` decodes on every
  call today, and that stays. Decoded audio exists for one track at a time,
  during its own export.

1 GB buys about twenty 5-minute WAVs, or two 45-minute ones, or a great many
MP3s. It is a number to test against, not a law: raise it when something measures
it as wrong.

Because nothing is cached, no eviction rule is needed, and section 3's transfer
rule can never hit a buffer someone else wants.

### It does not hold yet

**Export blob URLs are never revoked.** Every export leaks the encoded output of
every file, plus the zip:

| Created at | Revoked |
|---|---|
| `src/components/custom/AudioEditor.tsx:145` — the track | yes, on unmount |
| `src/lib/audio-worker.ts:28` — the encoded output | **no** |
| `src/lib/audio-service.ts:126` — the zip | **no** |

Ten `clip-30s.wav` files exported as WAV leak roughly 74 MB, and again on every
repeat. A ceiling that counts only tracks is meaningless while this runs.

This is a seventh defect, found while writing this design. It is
[018 — Export blob URLs are never revoked](../tickets/018-revoke-export-blob-urls.md).

Ticket 018 does **not** block ticket 008. Ticket 008 rewrites both files anyway,
so fixing them twice is waste. What ticket 008 inherits is the rule, not the
patch: revoke every blob URL it creates.

---

## 7. Facts found in the code while writing this

- `sliceAllFilesIntoZip` is serial. It awaits each file inside a `for` loop.
- `new AudioWorker()` runs once per file per export. `terminate()` appears
  nowhere in `src/`.
- Channel data is copied. That `postMessage` has no transfer list.
- Nothing caches a decoded buffer. `AudioLoader.loadAudioFile` decodes every
  call, and it decodes twice — once through an `AudioContext`, then again
  through a pointless `OfflineAudioContext` render.
- `AudioService.sliceAudioViaWorklet` is an empty stub that returns `null`.
  Ticket 008 deletes it. This design gives it nothing to become.
- Two encoded blob URLs per export are never revoked. See section 6.

---

## 8. What this does not answer

- **The encode share of a slice.** One browser run would give it. Every "not
  worth it" in section 4 rests on not having it.
- **The chunk size for the encoder's yield**, and what the yield costs.
- **Which formats the worker encodes.** WAV and MP3 today. 24-bit WAV and Opus
  belong to [011 — WebCodecs encoder path](../tickets/011-webcodecs-encoder-path.md).
- **Whether the ceiling needs a remove-one-track control.** There is none today,
  so "on screen" means "every track ever loaded". That is a feature decision.
- **What wavesurfer holds per card.** It decodes its own peaks and is outside
  this ceiling. Not measured.

---

## What ticket 008 can now assume

- Build the graph on the main thread. There is no other option.
- Send PCM to one long-lived worker, transferred, using the protocol in
  section 2.
- Do not build a pool. Do not overlap render and encode.
- Carry a generation number on every render. Drop stale results and revoke their
  URLs.
- Cache no decoded buffer.
- Revoke every blob URL it creates. Ticket 018 fixes the ones that exist.
- Delete `AudioTrimmer.trimAudio`, `getMaxAmplitude` and `sliceAudioViaWorklet`.
