# 006 — Install Vitest and wire it into the build

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** none
**Blocks:** [008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md), [010 — Build LUFS normalization with tests](./010-build-lufs-normalization.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can a DSP test run in this repo?

The repo has no test runner. Ticket 010 and ticket 008 both need one. This
ticket unblocks them and decides nothing else.

The work:

1. Install `vitest`. Note that the repo is on Vite 3 and TypeScript 4.9. Check
   the compatible Vitest version before installing. If Vite must be upgraded,
   stop and raise that as its own ticket — a Vite upgrade is not this ticket.
2. Add a `test` script to `package.json`.
3. Decide the environment. DSP tests need `AudioBuffer` and
   `OfflineAudioContext`, which `jsdom` does not provide. Options: a Node
   polyfill such as `node-web-audio-api`, a browser environment via
   `@vitest/browser`, or pure-array tests that avoid Web Audio entirely.
4. Write one real test to prove the setup works. Suggested: `getMaxAmplitude`
   from `src/lib/audio-processors.ts:169`, which is pure and needs no context.
5. Add a test job to `.github/workflows/build-and-deploy.yml`, or a separate
   workflow. Deploy is manual, so tests should run on push regardless.

## Answer format

A committed change plus one passing test. Record in the resolution which
environment was chosen and why, because every later DSP test depends on it.

If Web Audio cannot be made to work under test, say so plainly. The fallback is
to write the DSP as pure functions over `Float32Array`, and keep Web Audio only
at the edges. That would be a significant constraint on ticket 002.
