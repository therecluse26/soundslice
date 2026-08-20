# 011 — WebCodecs encoder path with fallback

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-19
**Blocked by:** none — was [008](./008-build-the-edit-stack.md), closed 2026-08-19, and [004](./004-research-webcodecs-audioencoder.md), closed 2026-08-18. Ticket 008 gave this ticket the seam it needs: one encode worker, one message protocol in `src/lib/encode-protocol.ts`, and `AudioService.exportSampleRate` already choosing a rate per format.
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can export use the browser's native encoder, and fall back cleanly where it
cannot?

`src/lib/audio-worker.ts` encodes MP3 with `@toots/shine.js`, in pure JS, at
line 106. It works and it is slow. It also hard-codes 320 kbps at line 112, and
the WAV writer hard-codes 16-bit at line 44.

The work:

1. Build an encoder interface with two implementations: WebCodecs and the
   existing `shine.js` plus hand-written WAV.
2. Feature-detect per format, using the method found in ticket 004. Choose the
   native encoder when it is supported, and the fallback when it is not.
3. Add the Advanced view formats found to be safe in ticket 004. Expected: FLAC,
   Opus, 24-bit WAV, and a sample rate choice.
4. Keep Simple view at WAV and MP3 only. Simple gains speed, not options.
5. Add muxing where a format needs a container, per ticket 004.
6. Report progress, per the worker boundary in ticket 007.

## Watch for

Encoding is per-region now, not per-track. Advanced view exports many regions
per track, so batch export encodes many more files than before. Measure the zip
path, not just one file.

`bufferToMp3` at `src/lib/audio-worker.ts:106` builds two full `Int16Array`
copies of the track before encoding. On a 45-minute track that is a large
allocation on top of the `Float32Array` already transferred.

## Acceptance

Export is faster than the ticket 001 baseline where WebCodecs is available. It
is no slower where it is not. Every offered format opens correctly in at least
two other players.

Note in the resolution which browser gets which encoder, so the map records it.

---

## Resolution — 2026-08-19

**Built. Four output formats, three encoders, one seam.**

Advanced view now offers **WAV, MP3, FLAC and Opus**, with a **bit depth** and a
**sample rate** beside them. Simple view still offers WAV and MP3, and nothing
else about it changed.

### Which encoder, and on which browser

| Format | Encoder | Container | Where |
|---|---|---|---|
| WAV 16 and 24-bit | written by hand, [`wav.ts`](../../src/lib/wav.ts) | RIFF, written by hand | every browser |
| MP3 320 | `@toots/shine.js`, pure JS | none — MPEG frames are self-framing | every browser |
| FLAC 16 and 24-bit | `@mediabunny/flac-encoder`, libFLAC in WASM | mediabunny | every browser |
| Opus 128 kbps | **the browser's own `AudioEncoder`** | mediabunny, **WebM** | Chrome and Edge 94+, Firefox 130+ desktop, Safari 26+ |

**Only Opus is native, and only Opus can be missing.** Ticket 004 read three
engines' source and that has not changed: Chromium encodes Opus and AAC, Firefox
Opus and Vorbis, WebKit answers "FLAC encoding is not supported" in as many
words. Opus is the one they share. So the Opus row is offered only when
`AudioEncoder.isConfigSupported` says yes to the exact config we would use — 48
kHz, stereo, 128 kbps — and the other three rows never ask the browser anything.

Verified in Chromium 146: the Opus row appears, and the export works.

### The two surprises

**1. An Opus slice is a `.webm` file, not a `.opus` file.** A `.opus` file is
Opus in Ogg, and Ogg needs the `OpusHead` header that only
`opus: { format: "ogg" }` produces. No engine implements it. So the select says
**Opus (.webm)** rather than writing a name the file is not.

**2. `worker.format: "es"` and a raised build target.** The FLAC and Opus path
imports mediabunny dynamically, so a WAV or MP3 user downloads none of it. A
dynamic import is code splitting, and Vite refuses to split the default IIFE
worker outright — *"UMD and IIFE output formats are not supported for
code-splitting builds"*. The fix is a module worker, which needs Chrome 80,
Firefox 114 or Safari 15.

That in turn broke the build a second way: Vite 3's default target includes
Safari 13, **which has no `BigInt`**, and mediabunny uses `0n` literals for
Matroska's 64-bit track ids. The target is now
`chrome80, edge80, firefox114, safari15` — narrower than the default and no
narrower than the module worker already required. **It has to be set twice**:
`build.target` for the bundle, and `optimizeDeps.esbuildOptions.target` for the
dependency pre-bundle the dev server makes. Setting only the first gives a build
that works and a `pnpm dev` that cannot load mediabunny.

### Two traps ticket 004 named, both avoided

**24-bit WAV writes `WAVE_FORMAT_EXTENSIBLE`, not format tag 1.** Read back from
the exported file: `fmt ` chunk 40 bytes, `wFormatTag` `feff` (0xFFFE),
`cbSize` 22, `wValidBitsPerSample` 24, channel mask `0x3` for stereo, and the
PCM subformat GUID. Windows Media Player refuses tag-1 24-bit, and this
ticket's acceptance names other players by title.

**Nothing resamples through an `AudioBufferSourceNode` any more.** Chrome and
Safari resample that path by linear interpolation, which aliases on the way
down. `RenderOptions.sampleRate` is **deleted**, not documented — the render
always uses its source buffer's rate, and a caller that wants another rate says
so at the decode, where `decodeAudioData` uses a real resampler.
`AudioLoader.loadAudioFile` takes a `chooseRate` for that, and
`AudioService.exportSampleRate` is the one place a rate is decided.

### Two other players, and a third

Every format was written from the app, then opened three ways.

| File | ffprobe reads | VLC | Chromium `decodeAudioData` |
|---|---|---|---|
| WAV 16 | `pcm_s16le` 44100 stereo 30.000 s | plays | reads back |
| WAV 24 | `pcm_s24le` 44100 stereo 30.000 s | plays | reads back |
| WAV 24 at 24 kHz | `pcm_s24le` **24000** stereo 30.000 s | plays | reads back |
| FLAC 16 | `flac` s16 44100 **16 bits** 30.000 s | plays | reads back |
| FLAC 24 | `flac` s32 44100 **24 bits** 30.000 s | plays | reads back |
| MP3 | `mp3` 44100 stereo 29.989 s | plays | reads back |
| Opus | `opus` in `matroska,webm` at **48000** 30.020 s | plays | reads back |

Every one reads back at the level it should: mean −29.9 dB and max −10.4 dB for
the four lossless files, within 1 dB for the two lossy ones.

**FLAC really is lossless.** Decoded to float and differenced against the WAV of
the same depth:

| Pair | Largest difference |
|---|---|
| FLAC 24 against WAV 24 | 1.192e-7 — **one 24-bit step** |
| FLAC 16 against WAV 16 | 3.052e-5 — **one 16-bit step** |
| WAV 24 against WAV 16 | 1.800e-5 — the 16-bit quantization itself |

One step is what two independent quantizers of the same float signal give. There
is no third value it could have been.

### Speed

**Opus beats MP3 everywhere, and FLAC beats them both.** Same session, same
machine, three runs, median kept.

Encode only, 5-minute stereo track:

| Format | ms | Size |
|---|---|---|
| WAV 16 | 523.1 | 50.39 MB |
| WAV 24 | 607.8 | 75.58 MB |
| **FLAC 16** | **1623.2** | **11.80 MB** |
| FLAC 24 | 1652.4 | 35.83 MB |
| **Opus 128** | **2741.5** | **4.72 MB** |
| MP3 320 | 4066.8 | 11.43 MB |

**FLAC 16 is 2.5× faster than MP3 320 and the file is the same size — and it
loses nothing.** That is the result nobody predicted.

The zip path, ten 30-second tracks, which is what this ticket said to measure:

| Format | ms | Zip |
|---|---|---|
| WAV 16 | 1601.9 | 50.47 MB |
| WAV 24 | 1783.2 | 75.70 MB |
| FLAC 16 | 2743.6 | 11.38 MB |
| **Opus 128** | **3516.3** | **4.70 MB** |
| MP3 320 | 4435.9 | 11.44 MB |

Opus is **−20.7%** against MP3 there. On the 45-minute file, whole slice:

| Format | ms | Size |
|---|---|---|
| WAV 16 | 12,955 | 454.2 MB |
| FLAC 24 | 24,773 | 323.5 MB |
| **Opus 128** | **31,716** | **42.6 MB** |
| MP3 320 | 38,377 | 103.0 MB |

**−17.4% against MP3, and a file 2.4× smaller.** The 45-minute track survives
both new formats, which is the size this ticket's "Watch for" was about.

### "No slower where it is not"

The one change on the WAV and MP3 path is that the WAV writer now **rounds**
rather than letting `DataView.setInt16` truncate toward zero. Measured directly,
both loops timed alternately over the same 5-minute buffer:

| | ms |
|---|---|
| truncating | 317.7, 319.1 |
| rounding | 330.5, 337.8 |

**+15.8 ms on a 5-minute track**, 5% of the sample loop and about 3% of a WAV
encode. The ten-file zip is +17.3 ms against ticket 010's figure, which is that
same cost ten times over on a tenth of the audio. Nothing else moved.

**This changes exported bytes**, so the four-row hash table from ticket 013 will
not match. It is worth it: truncation pulled every sample the same direction, a
bias of up to half a step, and the 24-bit path has to round by hand anyway. One
rule in one file beats two.

### One caution on cross-session numbers

This session ran under measurably higher machine load than the ticket 008 and
010 sessions — decode of the same file, on code that did not change, is +18.6%.
Every claim above is therefore a **same-session** comparison. See the baselines
addendum.

### Bundle

| Asset | After 010 | **After 011** |
|---|---|---|
| `index.*.js` gzip | 113.02 KiB | **113.34 KiB** |
| `AdvancedPanel.*.js` gzip | 3.00 KiB | 3.64 KiB |
| `encode-worker.*.js` raw | 78.87 KiB | 80.84 KiB |
| mediabunny, gzip | — | **174.18 KiB, on demand** |
| `@mediabunny/flac-encoder`, gzip | — | **84.08 KiB, on demand** |

**+0.32 KiB on the Simple bundle** for four formats, a bit depth and a sample
rate. mediabunny is 258 KiB gzip and a WAV or MP3 user downloads none of it —
checked by searching the built files for the string `Matroska`, which is absent
from the Simple bundle, the Advanced chunk **and** the encode worker.

`pnpm test` is 125 → **165 tests**.

### What this ticket did not do

- **No AAC, no Ogg `.opus`, no Vorbis.** Ticket 004 ruled all three out and
  nothing has changed. Ogg is impossible today: no engine emits the header it
  needs.
- **No bitrate control for Opus.** This ticket asked for four formats, a bit
  depth and a sample rate. A fifth number the user must judge by ear is not one
  of them. It is fixed at 128 kbps.
- **`shine.js` was not replaced.** `@mediabunny/mp3-encoder` exists and is a
  SIMD build of LAME, but MP3 is the compatibility format now rather than the
  only compressed one, and swapping a working encoder for an unmeasured one is
  its own ticket. Recorded in the map's fog.
