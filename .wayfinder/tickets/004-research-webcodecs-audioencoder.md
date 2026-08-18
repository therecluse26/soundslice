# 004 — Research: WebCodecs AudioEncoder

**Type:** `wayfinder:research`
**Status:** closed
**Assignee:** research agent (baselines session, 2026-08-18)
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

---

## Resolution — 2026-08-18

Findings on branch `research/webcodecs-audioencoder`, at
`.wayfinder/research/webcodecs-audioencoder.md`. Every claim carries a source
link, fetched live on 2026-08-18.

**The short answer to "where must `shine.js` still catch the fall?" is
everywhere, for MP3, permanently.** No browser can encode MP3 through WebCodecs
and none ever will: the MP3 codec registration defines no `AudioEncoderConfig`
extension at all. It is decode-only by design. WebCodecs does not remove the MP3
fallback from a single browser.

What WebCodecs changes is that MP3 stops being the only compressed option.

**Safe to offer in Advanced view**

| Format | Path |
|---|---|
| 24-bit WAV | hand-written PCM. No WebCodecs, no muxer, no feature detection, every browser. The cheapest win in ticket 011 — do it first. |
| Opus in WebM | WebCodecs plus a muxer. Chrome 94+, Firefox 130+ desktop, Safari 26+. 48 kHz, up to 2 channels. |
| Sample rate choice | `OfflineAudioContext` resampling, or a plain-JS resampler. Snap to Opus's rates when Opus is chosen. |

**Needs a WASM fallback on every browser, always:** MP3 and FLAC. Chromium has no
FLAC encoder path, Firefox allows only Opus and Vorbis, and Safari returns
"FLAC encoding is not supported".

**Do not offer:** Ogg `.opus` (no engine implements the Ogg container option),
AAC `.m4a` (absent on Firefox and on Chrome/Linux, and heavily config-constrained
where it exists), Vorbis (Firefox only).

### The finding that moves another ticket

**The whole Web Audio API is `[Exposed=Window]`.** `OfflineAudioContext`,
`AudioContext` and `AudioBuffer` are all `undefined` inside a worker.
`AudioEncoder` and `AudioData` are available.

Verified independently in Chromium 146 during this session, not just read.

Ticket 007 previously stated the opposite. It has been corrected. No Web Audio
node graph can run off the main thread, so any stage moved into a worker must be
rewritten as plain arithmetic over `Float32Array`.

### Also carried to ticket 011

- The encoder interface needs three implementations, not two: WebCodecs, WASM
  for MP3 and FLAC, and hand-written PCM. Muxing is a separate seam.
- Feature-detect the exact **config**, not the codec string, inside `try`/`catch`.
  There are three distinct failure modes.
- Capture `metadata.decoderConfig` from the first output chunk. Chrome emits it
  once and never again, and its sample rate may differ from the one requested.
