# 029 — Chain order, and the input slot

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was two items of the map's fog, *Reordering the signal
chain* and *A level-setting slot before the compressor*, graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Ticket 027 drew the signal chain in canonical order and its blocks could not
move. The fog said why reordering had to wait: ticket 008 found that the
canonical order could not express Simple view's own stack with both switches
on — `peakNormalization → compressor → loudness → limiter` — so "Reset order"
had nothing correct to reset to. Fill the hole, then let the blocks move.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| Which of the three fixes | **None of them.** Peak normalization moves to the input, straight after noise reduction. No second `gain`, no new operation. |
| Why that one | In Simple view's stack peak normalization **is** input gain staging: it lifts a quiet recording to the compressor's threshold. The order now says what each operation is for. |
| The new canonical order | `noiseReduction → peakNormalization → eq → compressor → gain → loudness → limiter` |
| How a block moves | Drag a tile to a side of another, or the **earlier** and **later** buttons in the open block — the keyboard's way to reorder. One move is one gesture. |
| Reset order | Puts the chain back to `CANONICAL_ORDER`, and keeps every block's settings. |
| Noise reduction | **Pinned first.** It cannot be moved, and nothing can be moved in front of it. |

## Resolution

`CANONICAL_ORDER` in `src/lib/edit-stack.ts` carries the reasoning as its doc
comment:

```
  clean up   →  level the input  →  shape  →  set the output level  →  catch
  noise         peak                EQ,       gain, loudness             limiter
                                    comp
```

**Every one of Simple view's four stacks is now canonical**, and a test checks
it, so "Reset order" always has a correct answer.

`moveInChain` and `shiftOperation` in `src/lib/signal-chain.ts` do the moving.
Both refuse to move noise reduction or to put anything before it. A profile is
measured on the untouched recording (ticket 036), so nothing may change the
level or the spectrum before it. `withNoiseFirst` holds the same rule for any
stack that arrives from elsewhere — a saved project, a pasted chain.
