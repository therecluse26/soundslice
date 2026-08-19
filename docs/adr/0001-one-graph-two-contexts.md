# One graph, played by two contexts

SoundSlice needs a live preview that is trustworthy — what you hear must be what
you export — and it must not freeze the page while a long export runs. We build
the edit stack into **one Web Audio graph from a single function**, then run that
same graph in a live `AudioContext` to preview it and an `OfflineAudioContext` to
export it. Both use the same nodes at the same 128-sample block size, so they
cannot disagree.

## Considered options

**Our own DSP over `Float32Array`, in a worker.** Rejected on a measurement. The
premise was that Web Audio freezes the page. It does not: probing the main thread
during a 5-minute export, four `OfflineAudioContext` renders took 1741 ms and
still drew 103 frames. The 454 ms freeze came from `AudioTrimmer.trimAudio`, our
own per-sample loop. Web Audio is `[Exposed=Window]`, so no node graph can run in
a worker at all — which means this option would also have forced us to rewrite
`DynamicsCompressorNode`, changing the sound of every export anyone had already
made, and to build preview as a second code path.

**Our own DSP for export, Web Audio for preview.** Rejected because it makes
preview a different implementation from export. They would drift, and the whole
point of a preview is that it does not.

## Consequences

- **`AudioWorklet` is load-bearing.** Anything Web Audio lacks — noise reduction,
  time and pitch, loudness measurement, render progress — is a worklet. Verified
  in Chromium 146: a worklet runs inside an `OfflineAudioContext`, sits in one
  graph beside a built-in node, does not block the main thread, reports progress
  from inside the render, and renders 60 s of audio in 209 ms.
- **The DSP inside a worklet is a plain function over `Float32Array`.** The
  worklet is a thin shell. That is what makes the maths testable in Node, with no
  browser, which is how DSP tests will be written.
- **No sample loop may run on the main thread.** This replaces the map's original
  standing rule 7, which blamed long renders. `AudioTrimmer.trimAudio` and
  `getMaxAmplitude` are deleted, not moved.
- **Loudness and peak normalization cost a second render pass**, because neither
  can know its gain until it has seen the whole region.
- **Cancelling an `OfflineAudioContext` mid-render is awkward**, and it still
  allocates its whole output up front — about 476 MB for a 45-minute stereo
  track. Both are left to the worker-boundary design.

Full design: [`.wayfinder/designs/edit-stack.md`](../../.wayfinder/designs/edit-stack.md).
