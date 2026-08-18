# 001 — Measure performance baselines

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
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
