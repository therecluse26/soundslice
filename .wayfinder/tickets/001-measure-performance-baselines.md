# 001 — Measure performance baselines

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-18 (baselines)
**Blocked by:** none
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What is today's speed, so the rewrite can be held to it?

Standing rule 4 says Simple view must not regress. There is no number to hold it
to yet. This ticket produces that number.

Measure the current `main` build, before any change. Use real files, not
synthetic ones. Suggested set: a 30-second clip, a 5-minute track, and a
45-minute podcast episode, in both WAV and MP3.

Record, per file:

- Decode time — `AudioLoader.loadAudioFile`, which decodes then re-renders offline
- Slice time — `AudioService.sliceAudio`, with every switch off
- Slice time — same, with normalize and post-processing on
- Export time — WAV writer, and `shine.js` MP3 encoder, separately
- Batch time — `sliceAllFilesIntoZip` over ten tracks
- Peak heap, via `performance.memory` or the DevTools memory panel
- Time to first waveform after dropping a file

Run each three times and keep the median. Note the machine and browser.

## Answer format

A committed markdown file at `.wayfinder/baselines.md` holding a table of the
numbers, the hardware, and the browser version. Later tickets compare against it.

Also note anything surprising found while measuring. Double decoding is already
known: `AudioEditor` decodes via `audioService.loadFile`, then `sliceAudio`
decodes the same file again.

---

## Resolution — 2026-08-18

The numbers are in [`.wayfinder/baselines.md`](../baselines.md). Ticket 008 must
match or beat every median there, on the same machine and browser.

**How they were taken.** A dev-only harness, `bench.html` plus
`src/bench/main.ts`, imports the shipped modules unchanged and times them.
Nothing under `src/lib` or `src/components` was instrumented. Test audio is two
real freely-licensed recordings, rebuilt by `scripts/fetch-bench-audio.sh`.
Chromium only, driven by Playwright. Three runs per measurement, median kept.

**Headline baselines.**

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

**Ten findings.** Full detail in the baselines file. The four that change other
tickets:

1. **A 45-minute track dies under repeated work.** Every stage survives one run.
   A three-run sweep killed the tab. Hardest constraint on tickets 007 and 008.
2. **The post-processing switch does nothing unless normalize is on.** Proven
   byte-identical. A fourth defect, raised as
   [013 — Post-processing switch does nothing unless normalize is on](./013-post-processing-guard-defect.md).
3. **Every file decodes to the machine's rate, not its own.** All six 44.1 kHz
   files decoded to 48 kHz. The same file on two machines can produce different
   output, which breaks standing rule 1.
4. **`performance.memory` does not count audio.** A 989 MB decoded buffer read as
   2.1 MB of heap. Ticket 007 must not take its memory ceiling from heap figures.

Also recorded: MP3 export is 7x slower than WAV and takes 35 s on a 45-minute
track; batch export is strictly serial; decoding does redundant work twice; the
trim loop is per-sample JavaScript; a 20 ms fade is hard-coded and unswitchable;
and standing rule 7 is already broken today, even by a 30-second clip.
