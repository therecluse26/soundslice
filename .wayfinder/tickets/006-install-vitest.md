# 006 — Install Vitest and wire it into the build

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-19 (build sweep)
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

   **Answered 2026-08-19 by
   [002 — Design the edit stack](./002-design-the-edit-stack.md): the third
   option, and no polyfill.** Every operation is either a built-in Web Audio node
   — somebody else's code, not ours to test — or an `AudioWorklet`. A worklet is
   a thin shell around a plain function over `Float32Array`. Test the function.
   Plain `node` environment, no browser.

   That also removes this ticket's worst case. It said "if Web Audio cannot be
   made to work under test… that would be a significant constraint on ticket
   002". Ticket 002 chose that constraint deliberately.
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

---

## Resolution — 2026-08-19

**Yes.** `pnpm test` runs 6 passing tests. Nothing was upgraded to make it work.

### The three decisions

| Decision | Answer |
|---|---|
| Version | **Vitest 0.34.6.** The last line that runs on Vite 3. |
| Environment | **Plain `node`.** No jsdom, no Web Audio polyfill, no browser. |
| Config | **A separate `vitest.config.ts`.** Not a `test` block in `vite.config.ts`. |

### Vite was not upgraded

The ticket said to stop and raise a ticket if Vite had to move. It did not.
Vitest 1 and later need Vite 5; 0.34.6 accepts `^3.0.0 || ^4.0.0 || ^5.0.0-0`
and reuses the one already installed. Checked after installing:

```sh
$ ls node_modules/.pnpm | grep '^vite@'
vite@3.2.11_@types+node@20.17.9_terser@5.36.0     # one, unchanged
```

`package-lock.json` agrees: `vite 3.2.11`, `vitest 0.34.6`. CI installs with
`npm i`, so both lockfiles were regenerated.

Vitest 0.34.6 also runs on Node 24.15.0, this machine's version, despite being
two years older than it.

### The environment, and why it has no Web Audio

**Plain `node`. This is the third option in the ticket, and no polyfill.**

Settled by [002 — Design the edit stack](./002-design-the-edit-stack.md). Every
operation is either a built-in Web Audio node — somebody else's code, not ours to
test — or an `AudioWorklet`. A worklet is a thin shell around a plain function
over `Float32Array`. Test the function, not the shell.

So this ticket also fixes the shape the DSP takes. `src/lib/dsp.ts` is the first
module of that shape, and its doc comment states the rule: **the moment it
imports an `AudioBuffer`, the tests need a browser.**

`getMaxAmplitude` was the ticket's suggested test subject. It took an
`AudioBuffer`, so it could not be tested under Node. It is now two pieces:

| Piece | Where | Tested |
|---|---|---|
| `maxAmplitude(channels: Float32Array[])` | `src/lib/dsp.ts` | yes, 6 cases |
| `getMaxAmplitude(buffer: AudioBuffer)` | `audio-processors.ts`, unchanged signature | no — it is four lines of shell |

The numbers it returns are unchanged. It pulls the channels out and hands them
over.

### Why the config is separate

`vite.config.ts` carries `terser`, `manualChunks` and a `define` block. Standing
rule 4 says Simple view must not regress, and the safest way to keep a test
setting out of the shipped bundle is to keep it out of the build config.

`tsconfig.node.json` now includes `vitest.config.ts`, so `tsc` checks it.

### The test file

`src/lib/dsp.test.ts`, beside the code it tests. It imports `describe`, `it` and
`expect` from `vitest` explicitly rather than using globals, so `tsc --noEmit`
type-checks it during `pnpm build` with no `types` entry in `tsconfig.json`.

Six cases, and one of them is a real decision rather than a smoke test:
**`maxAmplitude` does not clamp above full scale.** Decoded audio can exceed 1.0,
and clamping here would hide clipping from the limiter, which is the thing that
is supposed to catch it.

### CI

A new workflow, `.github/workflows/test.yml`, on `push` and `pull_request`.
Separate from `build-and-deploy.yml`, which is `workflow_dispatch` only —
waiting for a manual deploy to find a broken test means never finding it.

It type-checks first, then tests. `tsc` covers the test files, because
`tsconfig.json` includes all of `src/` and the tests live beside the code.

### Verified

```
$ pnpm test
 ✓ src/lib/dsp.test.ts  (6 tests) 2ms
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npx tsc --noEmit
(clean)
```

### What this unblocks

[008 — Build the edit stack](./008-build-the-edit-stack.md) and
[010 — Build LUFS normalization with tests](./010-build-lufs-normalization.md).
Ticket 010 needs the EBU Tech 3341 vectors from
[005](./005-research-lufs-bs1770.md) run against our own K-weighting. Those are
arrays of samples in and one number out, which is exactly this setup.
