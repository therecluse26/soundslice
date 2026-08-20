# Performance baselines

Resolution of [001 — Measure performance baselines](./tickets/001-measure-performance-baselines.md).

Standing rule 4 on the [map](./map.md) says Simple view must not regress. This
file is the number that rule is measured against. Ticket 008 must match or beat
every figure here, on the same machine and browser.

Measured 2026-08-18.

## How to reproduce

```sh
pnpm install
./scripts/fetch-bench-audio.sh     # downloads and builds bench-audio/
pnpm dev                           # then open http://localhost:5199/bench.html
```

Click "Run full benchmark", or call `window.__bench.runAll()`. The report lands
on `window.__benchReport`. Single stages can be timed alone through
`window.__bench.lib`.

The harness is `bench.html` plus `src/bench/main.ts`. It imports the shipped
modules unchanged. Nothing under `src/lib` or `src/components` is instrumented,
because instrumenting the code under measurement would corrupt the number.

## The machine

| | |
|---|---|
| CPU | AMD Ryzen 7 7840HS, 16 threads |
| RAM | 54 GB, plus 64 GB swapfile and 16 GB zram |
| OS | NixOS 26.11, Linux 7.0.10 x86_64 |
| Browser | Chromium, HeadlessChrome/146.0.0.0, driven by Playwright |
| Node | v24.15.0 |
| Commit | `e88e52ededa875b5b83b5be469072ef9e7abb41e` |

`src/` on this commit is byte-identical to `main`, so these are `main`'s numbers.

**This machine is large.** 54 GB of RAM is not a typical user machine. Treat the
memory figures as a ceiling this hardware never reached, not as a safe budget.

## The files

Real recordings, not synthetic tones. Both are freely licensed. Rebuild them
with `scripts/fetch-bench-audio.sh`.

| File | Source | Length | On disk |
|---|---|---|---|
| `clip-30s.wav` | Bach, Goldberg Aria, first 30 s | 30.00 s | 5.0 MB |
| `clip-30s.mp3` | same, 320 kbps | 30.00 s | 1.7 MB |
| `track-5m.wav` | Bach, Goldberg Aria, whole | 299.52 s | 50.4 MB |
| `track-5m.mp3` | same, 320 kbps | 299.52 s | 12.0 MB |
| `podcast-45m.wav` | LibriVox, Wizard of Oz, chapters 1-4 | 2700.00 s | 454.2 MB |
| `podcast-45m.mp3` | same, 320 kbps | 2700.00 s | 103.0 MB |

Music source: "The Open Goldberg Variations", Kimiko Ishizaka, CC0 1.0.
Speech source: "The Wonderful Wizard of Oz (version 5)", LibriVox, Public Domain
Mark 1.0.

## Choices made, so a later run repeats them exactly

1. **The region is the whole track.** `start = 0`, `end = duration`. That is the
   worst case, and it is deterministic.
2. **Batch export uses ten copies of `clip-30s.wav`.** Ten 45-minute tracks
   decode to about 9.9 GB. The 30-second clip is the only honest choice.
3. **Engine timings come from the dev server.** They are pure compute, so the
   dev server does not distort them.
4. **Time to first waveform comes from the production build**, served by
   `vite preview`. It includes module load, so the dev server would distort it.
5. **Three runs, median kept**, except where noted. The 45-minute files ran once
   per stage, for the reason in Finding 1.

## Engine timings

All figures in milliseconds. Median first, then every run.

### 30-second files

| Measurement | `clip-30s.wav` | `clip-30s.mp3` |
|---|---|---|
| Decode — `AudioLoader.loadAudioFile` | **79.4** (79.4, 78.5, 83.3) | **142.3** (142.3, 132.0, 171.9) |
| Slice, switches off — `AudioService.sliceAudio` | **192.3** (185.4, 192.3, 226.7) | **305.5** (266.2, 305.5, 330.5) |
| Slice, normalize + post-processing on | **378.7** (378.7, 368.2, 379.4) | **443.0** (471.9, 395.2, 443.0) |
| Trim only — `AudioTrimmer.trimAudio` | **44.9** (36.6, 45.5, 44.9) | **38.6** (36.4, 38.6, 51.1) |
| Pipeline only — `applyProcessingPipeline` | **171.2** (191.9, 171.2, 168.7) | **175.5** (178.7, 175.5, 171.6) |
| Export WAV — worker | **68.7** (68.7, 81.4, 61.2) | **64.8** (64.8, 64.0, 73.4) |
| Export MP3 — `shine.js` in worker | **386.0** (386.0, 398.6, 380.8) | **389.3** (389.3, 424.5, 371.0) |

### 5-minute files

| Measurement | `track-5m.wav` | `track-5m.mp3` |
|---|---|---|
| Decode | **836.5** (816.0, 836.5, 845.5) | **1262.7** (1262.7, 1363.0, 1238.3) |
| Slice, switches off | **2030.9** (2095.2, 2030.9, 1811.9) | **2329.2** (2353.0, 2329.2, 2255.1) |
| Slice, normalize + post-processing on | **3779.2** (3941.7, 3608.6, 3779.2) | **3843.5** (3808.4, 3843.5, 4239.8) |
| Trim only | **430.5** (430.5, 481.5, 378.2) | **429.0** (429.0, 438.9, 413.4) |
| Pipeline only | **1864.0** (1895.4, 1864.0, 1673.9) | **1805.1** (1776.1, 1805.1, 1905.7) |
| Export WAV | **545.0** (545.0, 594.0, 544.2) | **611.4** (611.4, 579.2, 678.6) |
| Export MP3 | **3931.3** (3874.0, 3931.3, 3987.7) | **4086.5** (4086.5, 3923.4, 4149.3) |

### 45-minute files

Decode ran three times. Every other stage ran once — see Finding 1.

| Measurement | `podcast-45m.wav` | `podcast-45m.mp3` |
|---|---|---|
| Decode | **7660.3** (8044.8, 7579.6, 7660.3) | **10346.4** (10346.4, 10505.3, 10137.9) |
| Slice, switches off | **16067.8** (1 run) | **19920.6** (1 run) |
| Slice, normalize + post-processing on | **32669.9** (1 run) | **35446.0** (1 run) |
| Trim only | **3873.7** (1 run) | **3639.0** (1 run) |
| Pipeline only | not re-measured | **15820.2** (1 run) |
| Export WAV | **5071.1** (1 run) | **5132.7** (1 run) |
| Export MP3 | not re-measured | **35236.4** (1 run) |

The two gaps are safe. Trim and export WAV differ by under 6% between the WAV
and MP3 sources, because those stages act on the decoded audio, whose shape is
identical. Only decode depends on the container.

### Batch export

Ten copies of `clip-30s.wav`, sliced with every switch off and zipped, through
`AudioService.sliceAllFilesIntoZip`. Four independent sets of three runs:

| Set | Runs | Median |
|---|---|---|
| 1 | 2339.4, 2289.3, 2348.9 | 2339.4 |
| 2 | 2401.7, 2314.6, 2362.3 | 2362.3 |
| 3 | 2382.9, 2410.4, 2374.5 | 2382.9 |
| 4 | 2309.6, 2446.9, 2343.0 | 2343.0 |

**Baseline: 2350 ms.** Twelve runs spanned 2289.3 to 2446.9 ms.

### Time to first waveform

Production build, served by `vite preview`. Timed from the `change` event on the
file input to the first waveform canvas with a non-zero width.

| File | Runs | Median |
|---|---|---|
| `clip-30s.wav` | 908.7, 819.6 | **864.2** |
| `track-5m.mp3` | 1800.5 | **1800.5** |
| `podcast-45m.mp3` | 10734.5 | **10734.5** |

For contrast, the same measurement on the dev server gave 2228.3 ms cold and
764.2 ms warm. Ticket 008 must compare production against production.

### Bundle size

Baseline for ticket 012, which requires the Simple view bundle to be no larger
than it is today.

| Asset | Raw | Gzip |
|---|---|---|
| `dist/assets/index.8ab4bf08.js` | 499.27 KiB | 153.72 KiB |
| `dist/assets/index.a57e804c.css` | 31.19 KiB | 5.87 KiB |
| `dist/assets/audio-worker.7b9cf9f1.js` | 75.09 KiB | not reported |

`bench.html` is absent from `dist/`. The harness does not ship.

### Peak heap

`performance.memory`, sampled every 100 ms. Read Finding 6 before using these.

| Scope | Peak |
|---|---|
| 30-second files | 156.0 MB |
| 5-minute files | 1044.4 MB |
| Batch export | 937.0 MB |

## Findings

### 1. The tab dies on a 45-minute track under repeated work

The automated three-run sweep of `podcast-45m.mp3` killed the browser tab. Every
stage completes when run once, so the failure is cumulative, not a single
allocation.

This is the sharpest constraint on ticket 008 and ticket 007. Today a 45-minute
track is survivable once and fatal on repetition. A user who changes a setting
and exports again is doing exactly the thing that kills it.

### 2. Post-processing does nothing unless normalize is on

`sliceAudio` guards the whole pipeline with `if (normalize)` at
`src/lib/audio-service.ts:61`. So "Apply Post Processing? Yes" with
"Normalize Levels? No" applies nothing at all — and the always-on `limit()` at
`src/lib/audio-processors.ts:342` never runs either.

Proven, not inferred. Four exports of `clip-30s.wav`, hashed:

| Normalize | Post-processing | Bytes | FNV-1a hash |
|---|---|---|---|
| No | No | 5760044 | `e57eea7d` |
| No | **Yes** | 5760044 | `e57eea7d` |
| Yes | No | 5760044 | `d66014f4` |
| Yes | Yes | 5760044 | `b696be4e` |

Rows one and two are byte-identical. The switch does nothing on its own.

This is a **fourth defect**, beyond the three the map lists. It is raised as
[013 — Post-processing switch does nothing unless normalize is on](./tickets/013-post-processing-guard-defect.md).

### 3. Every file decodes to 48 kHz, whatever its own rate

All six files are 44.1 kHz on disk. All six decoded to 48000 Hz, because
`decodeAudioData` resamples to the `AudioContext` rate, and that rate follows the
audio hardware.

Three consequences:

- Export sample rate is not the user's file's rate. It is the machine's.
- The same file on two machines can produce different output. That breaks
  standing rule 1, which requires byte-identical output for the same settings.
- Ticket 010 must measure loudness at whatever rate the buffer actually is, not
  assume 48 kHz.

### 4. Decoding does the work twice, then the engine does it again

`AudioLoader.loadAudioFile` decodes at `src/lib/audio-loader.ts:14`, then renders
the result through a full `OfflineAudioContext` at line 30. The render changes
nothing. It copies the whole track for no gain.

On top of that is the double decode the ticket already named: `AudioEditor`
decodes through `audioService.loadFile`, and `AudioService.sliceAudio` decodes
the same file again at `src/lib/audio-service.ts:53`.

So a 45-minute MP3 export pays roughly 10.3 s of decode twice, and half of each
is a pointless re-render.

**Half of this is already fixed, 2026-08-18.**
[009 — Replace the store's ref and rerender hack](./tickets/009-replace-store-rerender-hack.md)
removed the `audioService.loadFile` call, which was dead: it wrote to a private
buffer nothing ever read. Counted again in the production build, per file
dropped:

| | Recorded here | After ticket 009 |
|---|---|---|
| `decodeAudioData` calls on drop | 2 | **1** |
| offline renders on drop | 1 | **0** |
| time to first waveform, 30 s | 864.2 ms | 689 ms |

The wasteful `OfflineAudioContext` render inside `AudioLoader.loadAudioFile`
itself is untouched. That is still ticket 008's to remove. **Ticket 008 must beat
the newer figures, not the ones recorded above.**

### 5. MP3 export is the single slowest stage

`shine.js` is pure JavaScript. Against the hand-written WAV writer, on identical
audio:

| Length | Export WAV | Export MP3 | MP3 slower by |
|---|---|---|---|
| 30 s | 68.7 ms | 386.0 ms | 5.6x |
| 5 min | 545.0 ms | 3931.3 ms | 7.2x |
| 45 min | 5132.7 ms | 35236.4 ms | 6.9x |

35 seconds to export one file. This is the number ticket 011 exists to beat.

### 6. `performance.memory` does not count audio at all

Holding a decoded 45-minute stereo buffer — about 989 MB of `Float32Array` —
`usedJSHeapSize` read 2.1 MB. Audio lives outside the JS heap.

Every peak heap figure in this file therefore measures JavaScript objects only.
It is close to useless as an audio memory budget. Ticket 007 asks for the memory
ceiling as a number; it must not take that number from here.

The honest measurement is process RSS. Twelve 45-minute decodes held at once
reached 13.73 GB of Chrome RSS, for roughly 11.9 GB of audio, with no failure —
on a 54 GB machine. That is a property of this machine, not of the browser.

### 7. Batch export is serial

`sliceAllFilesIntoZip` awaits each `sliceAudio` inside the loop at
`src/lib/audio-service.ts:87`. Nothing overlaps.

Ten 30-second clips cost 2350 ms. Ten times the single-slice figure of 192.3 ms
is 1923 ms, so zipping adds about 430 ms and the rest is strictly sequential.
With 16 threads idle, this is the cheapest speed-up on the map.

### 8. The trim loop is per-sample JavaScript

`AudioTrimmer.trimAudio` copies sample by sample at `src/lib/audio-trimmer.ts:41`
rather than using `copyToChannel` or `subarray`. That is why trimming 45 minutes
costs 3.6 s to move data that is already in memory.

It also builds an `OfflineAudioContext` at the **full original length**
(`src/lib/audio-trimmer.ts:19`) purely to call `createBuffer`, then never renders
it.

### 9. A 20 ms fade is always applied and cannot be turned off

`src/lib/audio-trimmer.ts:28` hard-codes a 20 ms fade in and out on every slice.
There is no switch. The map's **Not yet specified** section lists a "Fade edges"
switch for Simple view; that switch already exists as unconditional behaviour.

Ticket 002 must decide whether the fade becomes an operation on the edit stack.
If it does, its default must stay 20 ms or every existing user's output changes.

### 10. Standing rule 7 is already broken today

Rule 7 says anything over 300 ms shows progress and runs in a worker. Today only
encoding runs in a worker.

Even a **30-second** clip breaks it: slicing with the switches on takes 378.7 ms
on the main thread. A 5-minute track takes 3.8 s. A 45-minute track takes 35.4 s,
with the UI frozen for all of it.

## What ticket 008 must beat

Every median in this file, on this machine and this browser. The headline set:

| Case | Baseline |
|---|---|
| Decode, 5-minute MP3 | 1262.7 ms |
| Slice, switches off, 5-minute MP3 | 2329.2 ms |
| Slice, processed, 5-minute MP3 | 3843.5 ms |
| Export WAV, 5-minute | 545.0 ms |
| Export MP3, 5-minute | 3931.3 ms |
| Batch, 10 x 30-second | 2350 ms |
| Time to first waveform, 30-second | 864.2 ms |
| Simple view bundle, gzip | 153.72 KiB |

And one acceptance that is not a number: a 45-minute track must survive repeated
export. Today it does not.

---

## Addendum — 2026-08-19: four tickets moved these numbers

The tables above are still `main`'s numbers, measured at commit `e88e52e`. They
are the record of what the engine did before this map touched it, and they are
not rewritten. This addendum records what has moved since, so ticket 008 aims at
the right target.

Same machine, same browser, same files, same method: three runs, median kept, dev
server for engine timings.

### Slice timings, after [013](./tickets/013-post-processing-guard-defect.md)

The `if (normalize)` guard is gone, so the pipeline — and therefore the limiter —
now runs on every export. The switches-off path pays for one limiter render that
it used to skip.

| Measurement | File | Was | Now | Delta |
|---|---|---|---|---|
| Slice, switches off | `clip-30s.wav` | 192.3 | **242.6** | +50.3 |
| Slice, switches off | `clip-30s.mp3` | 305.5 | **280.3** | −25.2 |
| Slice, switches off | `track-5m.wav` | 2030.9 | **2238.8** | +207.9 |
| Slice, switches off | `track-5m.mp3` | 2329.2 | **2729.8** | +400.6 |
| Slice, normalize + post on | `clip-30s.wav` | 378.7 | **349.5** | −29.2 |
| Slice, normalize + post on | `clip-30s.mp3` | 443.0 | **385.3** | −57.7 |
| Slice, normalize + post on | `track-5m.wav` | 3779.2 | **3233.1** | −546.1 |
| Slice, normalize + post on | `track-5m.mp3` | 3843.5 | **3632.9** | −210.6 |
| Batch, 10 × `clip-30s.wav` | | 2350 | **2777.1** | +427.1 |

A limiter pass timed alone, so the delta is attributable and not guessed:

| Limiter only | Median |
|---|---|
| `clip-30s.wav` | 66.9 ms |
| `track-5m.wav` | 645.1 ms |

The processed path is at or below its old figure everywhere. The MP3
switches-off rows moved inside the baseline's own spread — `clip-30s.mp3` ran
266.2, 305.5 and 330.5 ms above.

### Bundle size, after [014](./tickets/014-tailwind-config-in-simple-bundle.md)

`AudioEditor` no longer resolves the Tailwind config at runtime.

| Asset | Ticket 001 | Ticket 012 | Now |
|---|---|---|---|
| `index.*.js` raw | 499.27 KiB | 503.66 KiB | **442.01 KiB** |
| `index.*.js` gzip | 153.72 KiB | 155.02 KiB | **136.62 KiB** |
| `AdvancedPanel.*.js` gzip | — | 2.65 KiB | 2.65 KiB |
| `index.*.css` gzip | 5.87 KiB | 6.02 KiB | 6.02 KiB |

**Ticket 008 must beat 136.62 KiB gzip, not 153.72 KiB.** The old figure is now
17 KiB of slack it does not deserve.

### Memory, after [015](./tickets/015-release-track-audio.md)

Finding 6 said `performance.memory` does not count audio. It still does not, so
this is the Playwright Chromium tree's RSS from `/proc`, garbage collected through
CDP before each reading.

Ten `track-5m.wav` Files, 50.4 MB each, 503.9 MB total, held only by blob URLs:

| State | Chromium RSS |
|---|---|
| Before | 1252.7 MB |
| Ten blob URLs alive | 1525.6 MB |
| The same ten revoked | 1019.7 MB |

**A blob URL holds its file one for one.** A card now revokes on unmount, so a
track that is loaded but idle no longer costs its encoded file forever.

### Still unmeasured

The 45-minute files were not re-run. Finding 1 stands: a 45-minute track survives
one pass of each stage and dies on repetition. That is still ticket 008's hardest
acceptance, and it is now slightly worse on the switches-off path, because that
path does one more render than it did.

---

## Addendum — 2026-08-19: the engine rewrite

[008 — Build the edit stack and rewrite the engine](./tickets/008-build-the-edit-stack.md)
replaced the engine. Same machine, same browser, same files, same method: three
runs, median kept, dev server for engine timings and `vite preview` for time to
first waveform.

**Every headline number is beaten.** Standing rule 4 holds.

| Case | Ticket 001 | After 013 | **After 008** | Against the better of the two |
|---|---|---|---|---|
| Decode, 5-minute MP3 | 1262.7 | — | **556.7** | −55.9% |
| Slice, switches off, 5-minute MP3 | 2329.2 | 2729.8 | **1494.2** | −35.8% |
| Slice, processed, 5-minute MP3 | 3843.5 | 3632.9 | **2836.9** | −21.9% |
| Export WAV, 5-minute | 545.0 | — | **523.7** | −3.9% |
| Export MP3, 5-minute | 3931.3 | — | **3234.4** | −17.7% |
| Batch, 10 × 30-second | 2350 | 2777.1 | **1525.2** | −35.1% |
| Time to first waveform, 30-second | 864.2 | 689 | **631** | −8.4% |
| Simple view bundle, gzip | 153.72 KiB | 136.62 KiB | **111.95 KiB** | −18.1% |

### Every stage, both 30-second and 5-minute files

Medians in milliseconds. All four files now decode at **44100 Hz**, their own
rate, where all six used to decode at 48000 Hz whatever their rate.

| Measurement | `clip-30s.wav` | `clip-30s.mp3` | `track-5m.wav` | `track-5m.mp3` |
|---|---|---|---|---|
| Decode | 28.4 | 64.7 | 223.2 | 556.7 |
| Slice, switches off | 125.4 | 163.7 | 1172.7 | 1494.2 |
| Slice, normalize + post on | 262.5 | 298.8 | 2500.4 | 2836.9 |
| Render only, switches off, 1 pass | 59.3 | 62.7 | 597.6 | 593.8 |
| Render only, switches on, 3 passes | 196.7 | 196.5 | 1924.8 | 1922.1 |
| Render only, switches off, with progress | 62.1 | 66.2 | 590.6 | 601.0 |
| Encode WAV, channels copied | 51.1 | 52.2 | 523.7 | 520.0 |
| Encode MP3, channels copied | 332.5 | 327.6 | 3234.4 | 3244.8 |
| Encode WAV, channels transferred, 1 run | 103.6 | 98.8 | 932.0 | 949.3 |

Two rows from the original tables are gone, because the code they timed is gone.
`AudioTrimmer.trimAudio` is one `start(0, offset, duration)` call inside the
render, and `applyProcessingPipeline` is one graph. **Render only** covers both.

**Progress is free.** 597.6 ms against 590.6 ms on a 5-minute file is inside the
noise. It was not free at first — see the ticket.

**Transferring costs about 400 ms on a 5-minute file** against copying, and it
halves peak memory. That is the trade the worker boundary design took, and this
is the first time it has had a number.

### Finding 1 is fixed: a 45-minute track survives repeated export

The original sweep of `podcast-45m.mp3` **killed the browser tab** on the second
run. Three full passes now, decode plus render plus encode, byte-identical
output each time:

| Pass | Decode | Slice, switches off |
|---|---|---|
| 1 | 4735.8 | 13022.2 |
| 2 | 4598.6 | 13024.8 |
| 3 | 4846.8 | 13258.7 |

Against 10346.4 ms and 19920.6 ms, single-run, before. The processed path also
ran three times, at 28851.8, 28861.7 and 28728.5 ms, against 35446.0 ms.

Nothing degrades across passes. That is the point.

### Memory: nothing leaks, and one thing did

RSS of the Playwright Chromium tree, read from `/proc`, garbage collected
through CDP before every reading — the method ticket 015 established, because
finding 6 stands: `performance.memory` does not count audio.

**Thirty renders of `clip-30s.wav`, 302.8 MB of output:**

| | RSS growth | ms per render |
|---|---|---|
| no progress | +10.3 MB | 61.0 |
| `AudioWorklet` meter | **+322.8 MB** | 80.6 |
| `AudioWorklet` meter, port closed and node disconnected | **+316.4 MB** | — |
| `suspend()` and `resume()` | **−4.3 MB** | 63.8 |

Calling `audioWorklet.addModule` on an `OfflineAudioContext` keeps that context
alive, and the context holds the buffer it just rendered. There is no way to
release it: `OfflineAudioContext` has no `close()`, and its state is already
`"closed"` when rendering finishes. Ticket 002 chose the worklet for progress on
a measurement that did not look at memory. Ticket 008 replaced it.

**Three ten-file exports, 158.8 MB of zips and 158.8 MB of slices:**

| | |
|---|---|
| RSS before | 792.6 MB |
| RSS after 30 renders **and** the three exports | **784.5 MB** |
| Blob URLs created by the export path | **0** |

That is [018 — Export blob URLs are never revoked](./tickets/018-revoke-export-blob-urls.md)'s
acceptance, and it closes it.

### Bundle

| Asset | Ticket 001 | After 014 | After 017 | **After 008** |
|---|---|---|---|---|
| `index.*.js` gzip | 153.72 KiB | 136.62 KiB | 136.76 KiB | **111.95 KiB** |
| `jszip.min.*.js` gzip | in `index` | in `index` | in `index` | **27.98 KiB, on demand** |
| `AdvancedPanel.*.js` gzip | — | 2.65 KiB | 2.65 KiB | 2.62 KiB |
| `index.*.css` gzip | 5.87 KiB | 6.02 KiB | 6.02 KiB | 6.06 KiB |
| `encode-worker.*.js` raw | 75.09 KiB | — | — | 75.76 KiB |

The engine rewrite added about 3 KiB of its own. JSZip paid for it four times
over: it is 27.98 KiB gzip and only "Slice All Files" needs it, so it now
arrives on the click.

`pnpm test` is 10 → **89 tests**.

---

## Addendum — 2026-08-19: loudness normalization

[010 — Build LUFS normalization with tests](./tickets/010-build-lufs-normalization.md)
made "Normalize Levels?" measure loudness rather than peak. That costs an extra
render pass and a BS.1770 analysis, about 400 ms on a 5-minute track.

**Every headline number still beats the original baseline and the post-013
numbers.** Same machine, same browser, same files, three runs, median kept.

| Case | Ticket 001 | After 013 | After 008 | **After 010** |
|---|---|---|---|---|
| Slice off, 30-second WAV | 192.3 | 242.6 | 125.4 | **123.3** |
| Slice processed, 30-second WAV | 378.7 | 349.5 | 262.5 | **308.8** |
| Slice off, 5-minute WAV | 2030.9 | 2238.8 | 1172.7 | **1207.5** |
| Slice processed, 5-minute WAV | 3779.2 | 3233.1 | 2500.4 | **2801.2** |
| Slice off, 5-minute MP3 | 2329.2 | 2729.8 | 1494.2 | **1543.0** |
| Slice processed, 5-minute MP3 | 3843.5 | 3632.9 | 2836.9 | **3090.2** |
| Batch, 10 × 30-second | 2350 | 2777.1 | 1525.2 | **1584.6** |

A 45-minute MP3 with both switches on ran twice, at **26986.9** and **26915.8
ms**, against a 35446.0 ms single run that killed the tab on repetition.

What the loudness measurement itself costs, render only:

| File | Without | With | Cost |
|---|---|---|---|
| `clip-30s.wav` | 59.9 | 96.6 | +36.7 |
| `track-5m.wav` | 594.4 | 989.1 | +394.7 |

### Bundle

| Asset | After 008 | **After 010** |
|---|---|---|
| `index.*.js` gzip | 111.95 KiB | **113.02 KiB** |
| `AdvancedPanel.*.js` gzip | 2.62 KiB | 3.00 KiB |
| `encode-worker.*.js` raw | 75.76 KiB | 78.87 KiB |

The loudness DSP is **not** in the Simple bundle. It ships in the encode worker,
where it runs, and the target control ships in the Advanced chunk. Checked by
searching the built files for the K-weighting shelf constant: present in the
worker, absent from both others.

`pnpm test` is 89 → **125 tests**.

### An accuracy finding that predates this map

**`DynamicsCompressorNode` applies a makeup gain of +0.541 dB that nothing asked
for.** Measured in Chromium 146 with the limiter's own settings — threshold
−0.95 dB, ratio 20, knee 0 — a 1 kHz sine:

| Input | Output | Gain |
|---|---|---|
| −60.0 dBFS | −59.459 | **+0.541 dB** |
| −40.0 dBFS | −39.459 | **+0.541 dB** |
| −20.0 dBFS | −19.459 | **+0.541 dB** |
| −10.0 dBFS | −9.459 | **+0.541 dB** |
| −3.0 dBFS | −2.459 | **+0.541 dB** |
| −0.5 dBFS | −0.342 | +0.158 dB — above threshold, so compressing |

Constant below the threshold, so it is a gain and not compression. **Every
export this app produced before ticket 010 is 0.541 dB louder than its graph
says.** It is now measured at runtime and cancelled.

### Verified against an independent implementation

ffmpeg's `ebur128` filter, run on a file exported through the production UI with
both switches on and the target at −14 LUFS:

```
I:         -14.0 LUFS
Peak:       -1.2 dBFS
```

The same export before the makeup-gain fix read −16.8 LUFS and −0.5 dBFS.

---

## Addendum — 2026-08-19: four output formats

[011 — WebCodecs encoder path with fallback](./tickets/011-webcodecs-encoder-path.md)
added FLAC and Opus beside WAV and MP3, plus a bit depth and a sample rate.

### Read this before comparing to the tables above

**This session ran under measurably higher machine load than the ticket 008 and
010 sessions.** Decode of `track-5m.mp3` — on code that did not change — read
660.4 ms against 556.7 ms, +18.6%. Load average was 4.44 with an unrelated test
suite taking 19% of one core.

So every number below is a **same-session** comparison: each format measured
against the others in one run, on one machine, in one state. Cross-session
figures are recorded but should not be read to three digits.

### Encode only, `track-5m.wav`, three runs, median kept

| Format | ms | Size |
|---|---|---|
| WAV 16 | 523.1 | 50.39 MB |
| WAV 24 | 607.8 | 75.58 MB |
| **FLAC 16** | **1623.2** | **11.80 MB** |
| FLAC 24 | 1652.4 | 35.83 MB |
| **Opus 128** | **2741.5** | **4.72 MB** |
| MP3 320 | 4066.8 | 11.43 MB |

**FLAC 16 is 2.5× faster than MP3 320 and lands at the same size, losslessly.**
Opus is 1.48× faster than MP3 and 2.4× smaller.

### The zip path, ten 30-second tracks

| Format | ms | Zip | Against MP3 |
|---|---|---|---|
| WAV 16 | 1601.9 | 50.47 MB | −63.9% |
| WAV 24 | 1783.2 | 75.70 MB | −59.8% |
| FLAC 16 | 2743.6 | 11.38 MB | −38.2% |
| Opus 128 | 3516.3 | 4.70 MB | **−20.7%** |
| MP3 320 | 4435.9 | 11.44 MB | — |

### Whole slice, `podcast-45m.mp3`

The size that used to kill the tab.

| Format | ms | Size |
|---|---|---|
| WAV 16 | 12,955 | 454.2 MB |
| FLAC 24 | 24,773 | 323.5 MB |
| Opus 128 | 31,716 | 42.6 MB |
| MP3 320 | 38,377 | 103.0 MB |

Opus is **−17.4%** against MP3 at this size, for a file 2.4× smaller. Both new
formats complete; neither exhausts the tab.

### What rounding costs

The WAV writer now rounds rather than letting `DataView.setInt16` truncate
toward zero. Both loops timed alternately over the same 5-minute buffer, so a
change in machine load hits both equally:

| | ms |
|---|---|
| truncating | 317.7, 319.1 |
| rounding | 330.5, 337.8 |

**+15.8 ms on a 5-minute stereo track** — 5% of the sample loop, about 3% of a
WAV encode. The ten-file zip is +17.3 ms against ticket 010's 1584.6, which is
the same cost ten times over on a tenth of the audio each time.

**This changes exported bytes.** Ticket 013's four-row hash table will not match
its recorded hashes. Truncation biased every sample the same direction by up to
half a step, and the 24-bit path rounds by hand regardless.

### Every format, read back three ways

Written from the app, then opened with ffprobe, VLC and Chromium's own
`decodeAudioData`. All three read all seven.

| File | ffprobe | Level |
|---|---|---|
| WAV 16 | `pcm_s16le` 44100 stereo 30.000 s | −29.9 mean, −10.4 max |
| WAV 24 | `pcm_s24le` 44100 stereo 30.000 s | −29.9 mean, −10.4 max |
| WAV 24 at 24 kHz | `pcm_s24le` **24000** stereo 30.000 s | −29.9 mean, −10.4 max |
| FLAC 16 | `flac` s16 44100, 16 bits, 30.000 s | −29.9 mean, −10.4 max |
| FLAC 24 | `flac` s32 44100, 24 bits, 30.000 s | −29.9 mean, −10.4 max |
| MP3 320 | `mp3` 44100 stereo 29.989 s | −28.9 mean, −9.3 max |
| Opus 128 | `opus` in `matroska,webm` at **48000**, 30.020 s | −30.0 mean, −10.3 max |

FLAC is lossless, measured rather than assumed. Decoded to float and differenced
against the WAV of the same depth:

| Pair | Largest difference |
|---|---|
| FLAC 24 against WAV 24 | 1.192e-7 — **one 24-bit step** |
| FLAC 16 against WAV 16 | 3.052e-5 — **one 16-bit step** |
| WAV 24 against WAV 16 | 1.800e-5 — the 16-bit quantization itself |

### The 24-bit WAV header, byte by byte

Read back from an exported file. `WAVE_FORMAT_EXTENSIBLE`, not tag 1 — Windows
Media Player refuses tag-1 24-bit.

```
00000000: 5249 4646 0c20 7900 5741 5645 666d 7420  RIFF. y.WAVEfmt
00000010: 2800 0000 feff 0200 44ac 0000 9809 0400  (.......D.......
00000020: 0600 1800 1600 1800 0300 0000 0100 0000  ................
00000030: 0000 1000 8000 00aa 0038 9b71 6461 7461  .........8.qdata
```

`fmt ` size 40, `wFormatTag` 0xFFFE, block align 6, 24 bits, `cbSize` 22,
`wValidBitsPerSample` 24, channel mask 0x3, then the PCM subformat GUID.

The 16-bit header is unchanged: tag 1, a 16-byte `fmt ` chunk, `data` at 36.

### Bundle

| Asset | After 008 | After 010 | **After 011** |
|---|---|---|---|
| `index.*.js` gzip | 111.95 KiB | 113.02 KiB | **113.34 KiB** |
| `AdvancedPanel.*.js` gzip | 2.62 KiB | 3.00 KiB | 3.64 KiB |
| `jszip.min.*.js` gzip | 27.98 KiB | 27.98 KiB | 27.98 KiB, on demand |
| `encode-worker.*.js` raw | 75.76 KiB | 78.87 KiB | 80.84 KiB |
| mediabunny gzip | — | — | **174.18 KiB, on demand** |
| `@mediabunny/flac-encoder` gzip | — | — | **84.08 KiB, on demand** |

**+0.32 KiB of Simple bundle** buys four formats, a bit depth and a sample rate.
The 258 KiB of mediabunny arrives only when FLAC or Opus is chosen, and only
inside the worker: the string `Matroska` is absent from the Simple bundle, the
Advanced chunk and the encode worker alike.

`pnpm test` is 125 → **165 tests**.

---

## Addendum — 2026-08-19: preview

[019 — Wire preview onto the edit stack](./tickets/019-wire-preview-onto-the-edit-stack.md)
made the play button play the region through the edit stack.

### What preview costs in memory: nothing

wavesurfer's own `<audio>` element feeds the graph, so preview holds **no decoded
buffer at all**. The alternative — a second `AudioBufferSourceNode` sharing the
export's samples — was measured and rejected:

| Track | Decoded stereo buffer it would have held |
|---|---|
| 30 seconds | 10.6 MB |
| 5 minutes | 105.8 MB |
| 45 minutes | **952.6 MB** |

Against a 1 GB ceiling that already counts every loaded file. Nothing is held.

### What a measurement costs in time

Loudness and peak normalization need a decode and the measuring render passes
before preview can apply them:

| Track | Wait before first sound |
|---|---|
| 30 seconds | ~0.15 s |
| 5 minutes | ~2.3 s |
| 10 minutes | ~5 s |
| 45 minutes | ~23 s |

**Ten minutes is the limit.** Above it preview plays at once, says the level is
not the export's, and offers **Measure anyway**. The measurement is cached on
file name, region bounds, stack and sample rate, and an export fills the same
cache — so the first play after a slice is instant.

### The acceptance, measured rather than heard

An `AnalyserNode` was patched onto everything connecting to the speakers.
`clip-30s.wav`, region 1–30 s, **Normalize Levels: Yes** at −14 LUFS.

The analyser reads a mono downmix, so it under-reads a stereo peak by a fixed
amount. **The bias cancels in a ratio**, so what is compared is the gain each path
applied:

| | Preview, analyser | Export, ffmpeg |
|---|---|---|
| Stack bypassed | peak −13.19 dBFS, RMS −32.69 | raw region peak −10.4 dB, mean −29.8 |
| Stack applied | peak −3.85 dBFS, RMS −23.16 | peak −1.0 dB, mean −20.5 |
| **Gain applied, peak** | **+9.34 dB** | **+9.40 dB** |
| **Gain applied, RMS** | **+9.53 dB** | **+9.30 dB** |

**0.06 dB apart on peak.** The export's true peak reads −1.0 dBFS, the −1 dBTP
ceiling landing exactly where it should. The RMS pair differs by 0.23 dB because
the limiter is doing work at the higher level and not at the lower one, which is
the point of a limiter.

### A redraw storm that is not preview's

Found while proving the above, and raised as
[020 — The track card redraws on every timeupdate](./tickets/020-card-redraws-on-timeupdate.md).
`clip-30s.wav`, three seconds of playback:

| | Renders in 3 s |
|---|---|
| preview enabled | **172** |
| preview disabled | **382** |

`@wavesurfer/react`'s `useWavesurfer` calls `setCurrentTime` on every
`timeupdate`. The card reads none of that state. **Preview adds no renders**, and
this has always been here.

### Bundle

| Asset | After 010 | After 011 | **After 019** |
|---|---|---|---|
| `index.*.js` gzip | 113.02 KiB | 113.34 KiB | **115.40 KiB** |
| `AdvancedPanel.*.js` gzip | 3.00 KiB | 3.64 KiB | 3.64 KiB |
| `encode-worker.*.js` raw | 78.87 KiB | 80.84 KiB | 80.84 KiB |

**+2.06 KiB** for the preview graph, its hook, the switch and Radix's `Switch`.
It is in the Simple bundle deliberately: the switch appears in both views.

`pnpm test` is 165 → **186 tests**.

---

## Addendum — 2026-08-19: the card's redraws

[020 — The track card redraws on every timeupdate](./tickets/020-card-redraws-on-timeupdate.md)
removed `@wavesurfer/react` and the render storm it caused.

### Renders during playback

`clip-30s.wav`, region 1–30 s, counted with `countRender`, sound confirmed
present throughout by an `AnalyserNode` on the destination:

| | Renders |
|---|---|
| before, 3 seconds of playback | **382** |
| after, 27.5 seconds of playback | **0** |

About 127 renders a second, to none. `@wavesurfer/react`'s `useWavesurfer` calls
`setCurrentTime` on every `timeupdate`; the card reads the playhead from its own
ref and never touched that value.

### Nothing else moved

| Check | Before | After |
|---|---|---|
| wavesurfer instances created | 2 | **2**, after playback, two seeks, a region resize and six switch toggles |
| Renders during a region resize | 6 | **6** |
| `region-updated` events per resize | 1 | **1** |
| Preview gain, effects on against off | +9.34 dB | **+9.34 dB** |

Two of those are the acceptance: the waveform is not rebuilt, and preview still
schedules its envelope. The envelope was checked by position, not by presence —
a seek to 6 s scheduled position **5** and a seek to 22 s scheduled **21**, on a
region starting at 1 s.

### Bundle

| Asset | After 011 | After 019 | **After 020** |
|---|---|---|---|
| `index.*.js` gzip | 113.34 KiB | 115.40 KiB | **114.35 KiB** |
| `AdvancedPanel.*.js` gzip | 3.64 KiB | 3.64 KiB | 3.64 KiB |
| `encode-worker.*.js` raw | 80.84 KiB | 80.84 KiB | 80.84 KiB |

**−1.05 KiB**, by deleting a dependency rather than adding one.

### Where the Simple bundle has been

| Ticket | gzip |
|---|---|
| 001, the baseline | 153.72 KiB |
| 014, Tailwind config out | 136.62 KiB |
| 008, the engine rewrite | 111.95 KiB |
| 010, loudness | 113.02 KiB |
| 011, four formats | 113.34 KiB |
| 019, preview | 115.40 KiB |
| **020, this one** | **114.35 KiB** |

**−25.6% against the ticket 001 baseline**, with four output formats, a bit
depth, a sample rate, LUFS normalization and preview added along the way.

---

## Addendum — the Regions stretch, 2026-08-20

Tickets 021 to 026 built together: many regions per track, the region list and
its gestures, export naming, the command history, split on silence, and the
transient magnet.

### Simple view's output has not moved

Two trees run side by side — this one on port 5177, commit `b690dbb` on 5178 —
each slicing the same 30-second file through `AudioService.sliceTrack` at the same
settings, hashing the exported bytes.

| Row | Bytes | SHA-256 | Verdict |
|---|---|---|---|
| switches off, WAV | 5,292,044 | `99fbd8efecaf53852b51dd414bb03321b05d3b4cb10696de574bf013a84b07a7` | **identical** |
| switches on, WAV | 5,292,044 | `f32d62741f3e2f5f12ecb731ee1a22524a422c7d419f2c8c51a911b7ec600c7e` | **identical** |

The filename is `trimmed_clip-30s.wav` in both. A track's only region keeps
today's name exactly — no suffix — which is why nothing that already works
changed.

### Bundle

| Asset | After 020 | **After 026** |
|---|---|---|
| `index.*.js` gzip | 114.35 KiB | **117.98 KiB** |
| `AdvancedPanel.*.js` gzip | 3.64 KiB | 4.64 KiB |
| `RegionList.*.js` gzip | — | 1.53 KiB, on demand |
| `RegionMagnet.*.js` gzip | — | 0.62 KiB, on demand |
| `region-tools.*.js` gzip | — | 1.55 KiB, on demand |
| `encode-worker.*.js` raw | 80.84 KiB | 80.84 KiB |

**+3.63 KiB gzip**, and it is shared work rather than Advanced work: the store's
region list, the command history, the region reconciler and the export naming are
all on the Simple path. The Simple bundle was checked for Advanced strings —
"Split on silence", "Snap to transients" and "Loudness target" are all absent.
Only two hits appear, and both are benign: `region-tools` as a **preload
filename** inside a dynamic-import descriptor, and "Add region" as a history
**label** in the store.

**One redesign came out of this measurement.** Calling `useTransientSnap` from
`AudioEditor` cost **+4.99 KiB gzip** by pulling onset detection and the decoder
into the Simple bundle. A hook cannot be called conditionally, so it moved behind
`RegionMagnet`, a component that draws nothing and is imported dynamically.
Standing rule 6 is measured, not assumed.

### Where the Simple bundle has been

| Ticket | gzip |
|---|---|
| 001, the baseline | 153.72 KiB |
| 020, before this stretch | 114.35 KiB |
| **021–026, this stretch** | **117.98 KiB** |

**−23.3% against the ticket 001 baseline**, now with many regions, a region list,
undo and redo, split on silence and the transient magnet added on top of four
output formats, LUFS normalization and preview.

### What else was measured on the running app

| Claim | Figure |
|---|---|
| A playing card's renders | **0**, across 3 s and 12 `timeupdate` events |
| wavesurfer instances rebuilt | **0** — 1 before playback, 1 after |
| A 200-pixel drag's history entries | **1**, not 200 |
| That drag's `region-updated` events | **1** |
| Undo of that drag | 4.7418 s → **3.0 s** exactly |
| Editing one card's region | 4 renders on that card, **0** on the other |
| Split on silence, seven bursts | **7** regions, one undo entry |
| Peak in the 20 ms around an interior region edge | **0** |
| Padding kept at an interior edge | **100 ms**, to the millisecond |
| Transient detection accuracy | **0.1 ms** (1.8 s read as 1.8001 s) |
| Detections per track, after a drag | **1** |
| Region gain of −6 dB, on exported bytes | **−5.999 dB** |
| Export progress reports, two tracks of 7 and 1 regions | 326, `fileCount: 8`, **0 going backwards** |
| `pnpm test` | 186 → **295** |

### Addendum to the addendum — the inline rework, 2026-08-20

The region list under the waveform was replaced by controls drawn **on** the
region. Ticket 022 carries the reasoning; these are the numbers.

| Claim | Figure |
|---|---|
| Gain line dragged up 20 px on a 120 px region | 0 dB → **+6.0 dB** (20/120 × 36 dB) |
| The region's `start` during that drag | **1**, unmoved |
| Fade-in grip dragged 100 px of 1171, on 10.2 s | 20 ms → **891 ms** |
| Fade-out grip dragged 60 px | **543 ms** |
| History entries per drag | **1** each |
| ✕ on the region, then one Ctrl+Z | deleted, then restored **exactly** |
| A playing card's renders | **0**, across 3 s and 12 `timeupdate` events |
| wavesurfer instances rebuilt | **0** |
| Simple view's region colour | `rgba(254, 242, 242, 0.25)`, unchanged |
| Simple view's exported bytes | **identical** to `b690dbb`, both rows |
| `pnpm test` | 295 → **322** |

| Asset | After 026 | **After the rework** |
|---|---|---|
| `index.*.js` gzip | 117.98 KiB | **119.43 KiB** |
| `AdvancedPanel.*.js` gzip | 4.64 KiB | 4.22 KiB |
| `RegionList.*.js` gzip | 1.53 KiB | — deleted |
| `RegionToolbar.*.js` gzip | — | 1.71 KiB, on demand |
| `RegionInlineControls.*.js` gzip | — | 2.56 KiB, on demand |
| `RegionMagnet.*.js` gzip | 0.62 KiB | 0.61 KiB |
| `region-tools.*.js` gzip | 1.55 KiB | 1.56 KiB |

**+1.45 KiB gzip on the Simple bundle.** No Advanced-only module is in it,
checked by string: "Split on silence", "Delete this region", the overlay's
`polygon(0 0` clip path, its `rgba(9, 9, 11, 0.9)` shadow, the Unicode minus
`formatGain` writes, and `minSilenceMs` are all absent. The growth is in the
shared path — `AudioEditor` itself and the chunk graph — and it was **not**
isolated further than that.

### One thing that was not our code

`node_modules/wavesurfer.js` had been replaced by a real directory holding
**7.8.6**, where the lockfile pins **7.8.9**. Dated 08:31 on 2026-08-20. It broke
the build, because `exponentialZooming` is a valid `ZoomPluginOptions` key in
7.8.9 and not in 7.8.6, and `AudioEditor` has passed it since before this map.

`pnpm install --frozen-lockfile` reported "Already up to date" and did **not**
repair it — pnpm's store still held 7.8.9 and only the link into it was wrong.
Recreating `node_modules/wavesurfer.js` as a symlink to
`.pnpm/wavesurfer.js@7.8.9/node_modules/wavesurfer.js` fixed it. Worth knowing,
because it will look like a compile error in our code the next time it happens.

## Addendum — the signal chain and the meters, 2026-08-20

Ticket 027. Measured in the running app, on a **12-second 1 kHz tone at exactly
−20.00 dBFS peak, −23.01 dBFS RMS** — a signal whose every number is known in
advance, so a meter that is wrong cannot look right.

### The meters read the truth

| What | Reading |
|---|---|
| Input meter, tone alone | **−23.0** |
| The tone's actual RMS | −23.01 dBFS |
| Output meter, EQ at +6.0 dB on 1 kHz | **+6.0** above input |
| The exported file, same EQ | **−17.01 dBFS** — **+6.00** above the source |
| Four blocks: EQ, compressor, +6 gain, limiter — preview | **−6.2** |
| The same chain, exported and decoded | **−6.19 dBFS** |

The last pair is the one that matters. The drawn curve, the meter and the bytes
agree to a tenth of a decibel through a compressor.

### A defect the meters found in their first minute

| What | Before | After |
|---|---|---|
| Output meter, limiter only | −22.5 · **+0.5** | −23.0 · **+0.0** |

`usePreview` never called `calibrateAll`, so `makeupGain` answered 1 and
Chromium's own **+0.541 dB** limiter makeup was never divided out. The limiter is
unconditional, so every preview was 0.541 dB loud — and stopped being so after
the first export, because the calibration cache is shared. Inaudible, and never
findable by ear.

### Cost

| What | Reading |
|---|---|
| Renders during playback | **0**, across 181 animation frames |
| Meter loop, per frame | **0.062 ms** — 0.37% of a 60 Hz budget |
| What that covers | 2 subscribers × 2 taps × 2048 samples, plus 4 canvas draws |
| History entries per drag | **1** — from 12 pointer moves (EQ), 10 (compressor) |
| Wavesurfer instances rebuilt | **0** |

The loop reads nothing at all when the card is paused: `readMeters` answers
`false` on `element.paused` before touching an analyser.

### Bundle

| Chunk | Before | After |
|---|---|---|
| Simple view `index` | 117.98 | **120.26 KiB gzip** |
| `AdvancedPanel` | 4.22 | **10.28 KiB gzip** |
| `meter-canvas` | — | 1.11 KiB gzip |
| `ToolControls` | — | 1.01 KiB gzip |
| `useMeterPair` | — | 0.61 KiB gzip |
| `TransportMeters` | — | 0.44 KiB gzip |

The 0.83 KiB Simple view gained is all shared-path code: the two taps in
`preview.ts`, `peakOf` and `rmsOf` in `dsp.ts`, `setTrackStack` in the store, and
the stack in the history snapshot. No Advanced-only string is in the Simple
bundle — checked by searching the built chunk for `#22c55e`, `Equalizer`,
`lowshelf`, `peaking` and `Signal chain`. All zero.

`peakOf` and `rmsOf` are in `dsp.ts` rather than `meter.ts` **because of this
measurement**: with them in `meter.ts` the Simple bundle read 120.48, because
importing them dragged the ballistics, the scale and the formatting along.
