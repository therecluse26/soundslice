# 011 — WebCodecs encoder path with fallback

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [004 — Research WebCodecs AudioEncoder](./004-research-webcodecs-audioencoder.md), [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
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
