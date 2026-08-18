# 002 — Design the edit stack

**Type:** `wayfinder:grilling`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** none
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

What is an operation, and how does replaying a stack of them produce audio?

The edit stack is the spine of this map. Every feature writes to it. Get it
wrong and every later ticket pays.

Today `sliceAudio` decodes, trims, then pipes the buffer through
`applyProcessingPipeline`, which runs a fixed list of effects. The order is
hard-coded in `src/lib/audio-processors.ts:331`. There is no undo and no record
of what was applied.

Decide:

1. **The operation set.** What operations exist? Trim, fade, gain, EQ, loudness,
   compress, noise reduction, time-stretch — what else, and what does each carry?
2. **Order.** Is the stack user-ordered, or does it always render in a fixed
   canonical order? Some orders are wrong: normalizing after limiting is
   pointless. Does the user get to make that mistake?
3. **Replay.** One `OfflineAudioContext` graph, or a chain of renders? The
   current code renders once per effect, which means N full passes.
4. **Region and stack.** Does a region own a stack, or does a track? Advanced
   view allows many regions per track. Can two regions of one track have
   different EQ?
5. **Live preview.** The same stack must build a live `AudioContext` graph for
   preview. Which operations can preview live, and which cannot? Time-stretch
   and noise reduction may not.
6. **Serialisation.** The stack must survive being written to storage later, for
   saved projects. What shape does it take on disk?
7. **Undo.** Is undo "pop the last operation", or a separate command history?
   Changing an EQ slider should not push a hundred entries.

## Answer format

A written design, committed to `.wayfinder/designs/edit-stack.md`. It must name
the types, the render path, and the preview path. It must state which operations
are preview-capable.

Also record whether this needs an ADR. It is hard to reverse, surprising without
context, and the result of a real trade-off — so it probably does.
