# 013 — Post-processing switch does nothing unless normalize is on

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [002 — Design the edit stack](./002-design-the-edit-stack.md)
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

"Apply Post Processing? Yes" with "Normalize Levels? No" applies nothing. What
should it apply instead?

Found while measuring [001 — Measure performance baselines](./001-measure-performance-baselines.md).
This is a fourth defect, beyond the three the map lists.

## The defect

`AudioService.sliceAudio` guards the whole pipeline with a single condition at
`src/lib/audio-service.ts:61`:

```ts
if (normalize) {
  trimmedBuffer = await applyProcessingPipeline(trimmedBuffer, {
    normalize: normalize,
    compress: applyPostProcessing,
    trimSilence: trimSilence,
  });
}
```

So when normalize is off, `applyProcessingPipeline` is never called. Three things
then never happen:

1. Compression, even though the user asked for it.
2. Silence trimming, even though the user asked for it.
3. `limit()`, which `applyProcessingPipeline` marks `enabled: true` unconditionally
   at `src/lib/audio-processors.ts:342`. The comment there reads "Always limit the
   audio to prevent clipping, no reason not to". It is not always applied.

## The proof

Four exports of the same 30-second file, hashed with FNV-1a:

| Normalize | Post-processing | Bytes | Hash |
|---|---|---|---|
| No | No | 5760044 | `e57eea7d` |
| No | **Yes** | 5760044 | `e57eea7d` |
| Yes | No | 5760044 | `d66014f4` |
| Yes | Yes | 5760044 | `b696be4e` |

Rows one and two are byte-identical.

## What must be decided

This is not only a bug fix. Two questions need answers before the fix is right.

1. **Is `limit()` always on, or not?** The code says always and behaves
   otherwise. Standing rule 1 requires the same settings to give byte-identical
   output, so this must be settled once and stated. If limiting becomes truly
   unconditional, every export made with normalize off changes.
2. **What does the Simple view switch mean?** The tooltip at
   `src/components/custom/MasterToolbar.tsx:80` promises consistent levels.
   Ticket 003 maps every Simple setting onto an Advanced control, so
   "Apply Post Processing" must resolve to named operations on the edit stack.

Blocked on [002 — Design the edit stack](./002-design-the-edit-stack.md) because
the answer is a statement about operation order, not a patch to one `if`.

## Watch for

Fixing the guard makes every processed export slower, because the pipeline will
now run in cases where it silently did not. Measure against
[the baselines](../baselines.md) before and after. A slower Simple path breaks
standing rule 4 even when the cause is a bug fix.

The `trimSilence` operation is already known broken and is removed by ticket 008.
Do not restore it here.

## Acceptance

Every combination of the two switches produces the output its labels promise.
The four-row hash table above is regenerated, and no two rows collide unless the
settings genuinely mean the same thing.
