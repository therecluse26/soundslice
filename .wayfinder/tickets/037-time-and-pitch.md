# 037 — Time and pitch

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was one of the fourteen features with no chain,
graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Change a region's speed without changing its pitch, and its pitch without
changing its speed. In preview and in export.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| What it belongs to | **The region**, as `region.stretch { rate, semitones }`. Not an operation: two regions of one track may play at different speeds. |
| Range | Speed 0.5× to 2×. Pitch −12 to +12 semitones. |
| Order | Before the whole stack, after noise reduction. A compressor after a stretch hears what a listener hears. |
| Export | In the encode worker's prepare stage, like noise reduction (ticket 036). **Varispeed** — a 16-tap Blackman-windowed sinc resampler — for the speed, then a **phase-vocoder pitch shifter** (Bernsee, oversampling 4) to put the pitch where it was asked. |
| Preview | The media element's own `playbackRate` for the speed, and the same pitch shifter as an `AudioWorklet` to correct the pitch: `semitones − 12·log2(rate)`. About 43 ms late. |
| Where the controls are | A **Time & pitch** popover in the region toolbar, for the selected region. It shows how long the region plays for. One slider drag is one gesture. |
| Clear | Ticket 031's Clear removes every stretch. |

## Resolution

The prepare stage (`src/lib/prepare-source.ts`) copies each region plus 0.1 s
either side, denoises and stretches it in the worker, lays the results into a
new buffer and moves each region to where its audio now sits. Every region
keeps its id, so crossfades and the join order are untouched. A stack with no
noise reduction and regions with no stretch skip all of it, byte for byte.

**Checked in the browser, 4 s regions at 48 kHz:** speed 2× gave **96 000**
frames, exactly half; +12 semitones at speed 1 gave **192 000**, exactly the
same length. In the popover, three steps right on Speed and one left on Pitch
stored `{ rate: 1.03, semitones: -1 }` and set the preview element's
`playbackRate` to 1.03.
