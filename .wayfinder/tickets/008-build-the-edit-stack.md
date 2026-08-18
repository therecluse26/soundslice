# 008 — Build the edit stack and rewrite the engine

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [002 — Design the edit stack](./002-design-the-edit-stack.md), [006 — Install Vitest](./006-install-vitest.md), [007 — Design the worker boundary](./007-design-the-worker-boundary.md), [013 — Post-processing switch does nothing unless normalize is on](./013-post-processing-guard-defect.md)
**Blocks:** [010 — Build LUFS normalization with tests](./010-build-lufs-normalization.md), [011 — WebCodecs encoder path with fallback](./011-webcodecs-encoder-path.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can the whole engine be rewritten onto the edit stack, with no loss of function
and no loss of speed?

This is the spine of the map. It builds the design from ticket 002, inside the
worker boundary from ticket 007, and holds itself to the baselines from ticket
001.

The work:

1. Build the operation types and the stack, per the design in ticket 002.
2. Build the render path — replay a stack into audio.
3. Build the live preview path — the same stack as a live `AudioContext` graph.
4. Rewrite `src/lib/audio-service.ts`, `src/lib/audio-trimmer.ts` and
   `src/lib/audio-processors.ts` onto it. The old functions become operations.
5. Keep Simple view working the whole way. It must produce the same output as
   before, for the same settings.
6. Add DSP tests for each operation.

**Defects fixed by this ticket** (two of the three on the map):

- `trimSilence()` at `src/lib/audio-processors.ts:185` reads the analyser before
  the offline render runs, so it reads zeros. It cannot work as written. Its
  toggle is already commented out at
  `src/components/custom/MasterToolbar.tsx:127`. It is redesigned as region
  detection in a later feature ticket. Remove the broken version here.
- Double decoding. `AudioEditor` decodes via `audioService.loadFile`, then
  `AudioService.sliceAudio` decodes the same file again at
  `src/lib/audio-service.ts:53`. One decode per track.

## Acceptance

Every baseline number from ticket 001 is matched or beaten, on the same machine
and browser. Record the new numbers beside the old ones.

If any Simple-path number is worse, this ticket is not done. Standing rule 4 has
no exceptions for the Simple path.
