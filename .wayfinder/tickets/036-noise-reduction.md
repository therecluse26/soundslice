# 036 — Noise reduction

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was one of the fourteen features with no chain,
graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

`noiseReduction` was a named operation with a `NoiseProfile` type and no
implementation. Build it: learn a profile, subtract it, in preview and in
export.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| The method | **Spectral subtraction** against a learned profile. STFT, 2048 points, sqrt-Hann window, hop N/4. Over-subtraction `1 + amount`; a floor of −24 dB × amount; gains smoothed 0.6/0.4 across frames. |
| Learning | From the **selected region**, which must hold only noise and be at least 0.25 s long. "Learn" and "Relearn" in the block. |
| Where it sits | **Always first.** A profile describes the raw recording (ticket 029). |
| Export | Not a node. `addModule` on an `OfflineAudioContext` leaks the whole context in Chromium — 322 MB over 30 renders — so export denoises in the **encode worker**, in a *prepare stage* before the graph. |
| Preview | An `AudioWorklet` on the shared live context, built from the **same source** as the worker's code. |
| One source for both | `spectralKit()` in `src/lib/spectral.ts`, written self-contained — no classes, no outer references — so its text can be shipped to the worklet with `toString()`. A test proves it runs from `new Function`. |
| Latency | The real delay is the **whole window, N = 2048 samples**, not N − hop. An impulse test found it. `runOffline` pads and slices by it, so export is sample-aligned. |
| Another sample rate | A profile records the rate it was measured at and is re-read by frequency, not by bin. |
| Stored | In the stack, so it is saved with the project (ticket 038) as base64. |

## Resolution

**Checked in the browser, `clip-30s.wav` at 48 kHz.** Profile learned from 0–2 s
in **59 ms**. Exported 2–6 s at amount 0.8: RMS **0.03523 → 0.00386**, about
**19.2 dB** down, frame count unchanged at 192 000, in 223 ms. Preview through
the worklet took the same audio **16.9 dB** down.

**Found in the browser and fixed.** With a stretched region (ticket 037),
preview took the noise down only **3.4 dB**: the speed and pitch shift happen
before the stack in preview, so the noise had moved off the profile. Export is
right because it denoises first. `profileForStretch` in `src/lib/preview.ts`
reads the profile at `2^(semitones/12)` times its rate, which puts each bin back
on top of the moved noise. Measured after: **19.1 dB**.
