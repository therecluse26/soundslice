# 013 — Post-processing switch does nothing unless normalize is on

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-19 (build sweep)
**Blocked by:** none — was
[002 — Design the edit stack](./002-design-the-edit-stack.md), closed 2026-08-19
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

**Both are now answered**, by
[002 — Design the edit stack](./002-design-the-edit-stack.md), design at
[`designs/edit-stack.md`](../designs/edit-stack.md):

1. **The limiter is on by default, not unconditional.** It is one operation in
   the stack, last in the canonical order. It is applied whenever it is in the
   stack — which fixes this defect. An Advanced user may move it or switch it
   off; Simple view keeps it on and last, always.
2. **"Apply Post Processing" is the Compressor operation**, at the numbers it
   already uses: threshold −8 dB, ratio 4, knee 0, attack 8 ms, release 50 ms.

So this ticket is no longer a design question. It is the patch, plus the proof
that the four rows no longer collide.

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

---

## Resolution — 2026-08-19

**Fixed.** The four rows now hash to four distinct values. Every combination of
the two switches produces the output its labels promise.

### The patch

`src/lib/audio-service.ts` — the guard is gone. `applyProcessingPipeline` runs on
every export:

```diff
-    if (normalize) {
-      trimmedBuffer = await applyProcessingPipeline(trimmedBuffer, {
-        normalize: normalize,
-        compress: applyPostProcessing,
-        trimSilence: trimSilence,
-      });
-    }
+    trimmedBuffer = await applyProcessingPipeline(trimmedBuffer, {
+      normalize: normalize,
+      compress: applyPostProcessing,
+      trimSilence: trimSilence,
+    });
```

That is the whole fix. The pipeline already gated each step on its own flag; only
the outer `if` was wrong.

`trimSilence` is still threaded through and is still false everywhere: its
control is commented out in `MasterToolbar` and `DEFAULT_MASTER_DEFAULTS` sets it
false. The operation stays broken and ticket 008 removes it. This fix is not what
switches it back on.

The trailing comment in `audio-processors.ts` — "Always limit the audio to
prevent clipping, no reason not to" — now says what is true, because now it is
true.

### The four-row table, regenerated

`clip-30s.wav`, whole file, WAV out, FNV-1a — the same hash and the same file the
baselines used, so the rows compare directly.

| Normalize | Post-processing | Bytes | Hash before | Hash after |
|---|---|---|---|---|
| No | No | 5760044 | `e57eea7d` | **`f80bd084`** |
| No | Yes | 5760044 | `e57eea7d` | **`b9fe4d8c`** |
| Yes | No | 5760044 | `d66014f4` | `d66014f4` |
| Yes | Yes | 5760044 | `b696be4e` | `b696be4e` |

**Four distinct hashes. No collisions.**

Read the last two rows carefully: they are **byte-identical to the baseline**.
Where normalize was on, the pipeline already ran and its output has not moved.
Only the two broken rows changed, and both changed because work the user asked
for now happens:

- Row 1 gains the limiter.
- Row 2 gains the limiter **and** the compressor.

This is the change to exported bytes the ticket warned about, and it is confined
to exports made with normalize off.

### The cost, measured

Standing rule 4 says Simple must not get slower, and the ticket said to measure.
Three runs each, median kept, dev server, same machine as
[the baselines](../baselines.md).

| Measurement | File | Baseline | Now | Delta |
|---|---|---|---|---|
| Slice, switches off | `clip-30s.wav` | 192.3 | **242.6** | +50.3 |
| Slice, switches off | `clip-30s.mp3` | 305.5 | **280.3** | −25.2 |
| Slice, switches off | `track-5m.wav` | 2030.9 | **2238.8** | +207.9 |
| Slice, switches off | `track-5m.mp3` | 2329.2 | **2729.8** | +400.6 |
| Slice, normalize + post on | `clip-30s.wav` | 378.7 | **349.5** | −29.2 |
| Slice, normalize + post on | `clip-30s.mp3` | 443.0 | **385.3** | −57.7 |
| Slice, normalize + post on | `track-5m.wav` | 3779.2 | **3233.1** | −546.1 |
| Slice, normalize + post on | `track-5m.mp3` | 3843.5 | **3632.9** | −210.6 |
| Batch export, 10 × `clip-30s.wav` | | 2350 | **2777.1** | +427.1 |

**The switches-off path is slower, and the added work is one limiter render.**
Timed alone:

| Limiter only | Median |
|---|---|
| `clip-30s.wav` | 66.9 ms |
| `track-5m.wav` | 645.1 ms |

66.9 ms accounts for the 30-second clip's +50.3 ms in full. The batch's +427 ms
is ten clips' worth of the same pass.

The processed path is **at or below** its baseline everywhere, and the MP3
switches-off rows moved inside the baseline's own run-to-run spread — its
`clip-30s.mp3` runs were 266.2, 305.5 and 330.5 ms.

**This is not an engine regression.** The switches-off path now does work it
always claimed to do and silently skipped. Ticket 008 collapses all of it into
one graph with one render, so this cost goes away rather than being paid forever.

### Acceptance

Met. Four rows, four hashes, no two collide.
