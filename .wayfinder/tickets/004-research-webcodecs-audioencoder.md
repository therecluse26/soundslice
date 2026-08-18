# 004 — Research: WebCodecs AudioEncoder

**Type:** `wayfinder:research`
**Status:** open
**Assignee:** research agent (charting session, 2026-08-18)
**Blocked by:** none
**Blocks:** [011 — WebCodecs encoder path with fallback](./011-webcodecs-encoder-path.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What can `AudioEncoder` actually do today, and where must `shine.js` still catch
the fall?

Today `src/lib/audio-worker.ts` writes WAV by hand and encodes MP3 with
`@toots/shine.js`. Shine is pure JS and slow. WebCodecs encodes natively.

Find out:

1. **Browser support.** `AudioEncoder` for encoding, not decoding, per evergreen
   Chrome, Edge, Firefox and Safari. Firefox is believed to lack audio encoding.
   Confirm with a primary source, and give versions.
2. **Codecs.** Which codec strings work for encoding, per browser. Specifically
   Opus, AAC, FLAC, and MP3. Include the exact `codec` string each needs.
3. **Containers.** `AudioEncoder` emits raw `EncodedAudioChunk`. Getting a
   playable `.opus`, `.m4a` or `.flac` file needs a container. State what
   muxing is required per format, and name a library if one is needed.
4. **API shape.** The full flow from an `AudioBuffer` to a `Blob`. How
   `AudioData` is built from `Float32Array` channel data. Planar versus
   interleaved. Sample format strings such as `f32-planar`.
5. **Worker support.** Whether `AudioEncoder` is available inside a Web Worker.
   The existing encoder already runs in one.
6. **Feature detection.** The correct way to test support before use.
   `AudioEncoder.isConfigSupported()` and what it returns.
7. **Bit depth and sample rate.** How to emit 24-bit WAV and how to resample.
   `OfflineAudioContext` can resample; confirm the approach.

## Answer format

Findings committed to a throwaway branch `research/webcodecs-audioencoder`, as a
markdown file with a source link per claim. Include a working code sketch of
`AudioBuffer → Blob` for at least Opus.

State clearly which formats are safe to offer in Advanced view, and which need
the `shine.js` fallback on which browsers.
