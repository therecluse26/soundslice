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
