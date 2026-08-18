# 010 — Build LUFS normalization with tests

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [005 — Research LUFS per ITU-R BS.1770](./005-research-lufs-bs1770.md), [006 — Install Vitest](./006-install-vitest.md), [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can loudness normalization replace peak normalization, under the existing
switch, without the user noticing a new control?

`normalize()` at `src/lib/audio-processors.ts:135` divides by the loudest single
sample. That is peak normalization. It makes levels *consistent in peak*, which
is not what the tooltip at `src/components/custom/MasterToolbar.tsx:80` promises:
"this will make the levels more consistent".

The work:

1. Build the LUFS measurement from the findings in ticket 005: K-weighting,
   400 ms blocks at 75% overlap, absolute gate at -70 LUFS, relative gate.
2. Build the gain calculation to reach a target.
3. Write it as a **pure function over `Float32Array`**, so it tests without Web
   Audio. Then wrap it as an operation on the edit stack.
4. Write Vitest cases from the test vectors in ticket 005. Every published
   reference value must pass, inside the stated tolerance.
5. Add true-peak limiting after the gain, so the result cannot clip. Check how
   this interacts with the existing `limit()`, which is always on at
   `src/lib/audio-processors.ts:342`.
6. Wire it under Simple view's existing "Normalize Levels?" switch, at a -14 LUFS
   default. Simple gains no new control.
7. Expose the target as a number in Advanced view.

## Watch for

`getMaxAmplitude` at `src/lib/audio-processors.ts:169` walks every sample of
every channel on the main thread. LUFS measurement is heavier still. It must
respect the worker boundary from ticket 007.

Keep peak normalization available as its own operation. It is still the right
tool for some jobs, and Advanced view should offer both. `CONTEXT.md` already
separates the two terms.

## Acceptance

Every reference vector passes. A quiet track and a loud track, both normalized
to -14 LUFS, sound equally loud. Neither clips.
