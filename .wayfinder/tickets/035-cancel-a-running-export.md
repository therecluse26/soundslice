# 035 — Cancel a running export

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *Cancelling a running export*,
graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

The engine could already stop: `renderRegion` took `isCancelled`, and a
5-minute MP3 encode abandoned in 76.5 ms. There was no button. Where it lives,
and what happens to a half-built zip, belonged to whichever ticket added it.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| The signal | An `AbortController`. `isCancelled` became `signal`. |
| Where it is checked | Between render passes, between items, inside the prepare stage, and in the encoder through `cancel(id)`. |
| Where the button is | The card's export shows **Cancel** in place of its button. The master toolbar's export shows Cancel on its progress overlay. |
| A half-built zip | **Thrown away.** Nothing downloads. A cancelled call returns `null`, and the caller does nothing with `null`. |
| Two exports at once | Each has its own controller: the card's in a ref, the master's in the store, so the overlay can reach it. |

## Resolution

`SliceOptions { onProgress, signal }` in the audio service. `sliceRegions`,
`sliceTrackFiles` and `sliceAllFilesIntoZip` each return `null` when cancelled.

**Checked in the browser:** a two-track zip aborted 30 ms after it started
returned `null` in **37 ms**.
