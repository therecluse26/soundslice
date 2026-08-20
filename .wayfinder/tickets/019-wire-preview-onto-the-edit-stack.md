# 019 — Wire preview onto the edit stack

**Type:** `wayfinder:grilling`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

The card's play button plays the file. It should play the region, through the
stack. What has to change, and what breaks when it does?

Raised by [008 — Build the edit stack](./008-build-the-edit-stack.md), which
built the path and did not wire it.

## Where this stands

[`src/lib/preview.ts`](../../src/lib/preview.ts) exists. It calls the same
`buildGraph` the export path calls, given a live `AudioContext`, so what you
hear and what you export **cannot** disagree. That is
[ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md).

**Nothing calls it.**

The card plays through wavesurfer, which owns an `<audio>` element and its own
playhead, scroll, click-to-seek and `region-out` handling. So today the play
button plays the raw file, with no region gain, no fades and no operations.
Nobody has noticed, because Simple view has no operation a user can hear until
they export.

Ticket 008 stopped here on purpose. Ticket 008's job was the engine, and moving
playback is a UI change with its own failure modes.

## What must be decided

1. **Who owns the sound.** wavesurfer plays its own `<audio>` element. Options:
   mute wavesurfer and play the Web Audio graph beside it, or feed wavesurfer's
   media element into the graph with `createMediaElementSource`. The second keeps
   one clock; the first keeps one code path. They cannot both be true.
2. **The playhead.** wavesurfer draws its cursor from its media element's
   `currentTime`. A graph driven by `AudioBufferSourceNode` has no media element.
   Something has to drive the cursor.
3. **Seeking.** Clicking the waveform restarts an `AudioBufferSourceNode`; it
   cannot be scrubbed. Every seek is a stop and a fresh `start(when, offset)`.
   Compressors and EQ have memory, so the first moment after a seek settles
   differently — every DAW behaves this way, and the design says so.
4. **Where the decoded buffer comes from.** The worker boundary design section 6
   says **no decoded buffer is ever cached**. Preview needs one for as long as it
   plays. Is preview an exception, and if so what is its ceiling?
5. **The Preview effects switch.** `preview.ts` takes `effects: boolean` and the
   design gives it one switch, on by default. Where does it live, and does it
   count as an Advanced setting on the chip?

## Watch for

**This is the first thing that makes the 1 GB ceiling bite.** A track that is
merely loaded costs its encoded file. A track being previewed costs its decoded
buffer too — 115.2 MB for five minutes, 1.04 GB for forty-five.

## Acceptance

Playing a region and exporting it produce the same audio, proved by ear on a
setting that is audible, and by the region's own gain and fades being present in
both.
