# 015 — Track audio is never released

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can a track's audio be released when its card goes away?

Found while resolving
[009 — Replace the store's ref and rerender hack](./009-replace-store-rerender-hack.md),
where the obvious fix was tried and reverted.

## The defect

`AudioEditor` creates a blob URL for its file and never revokes it:

```ts
const url = useMemo(() => URL.createObjectURL(file), [file]);
```

A blob URL pins its blob in memory until it is revoked. So every track holds its
whole encoded file for the life of the page, whether or not its card is still on
screen. A 45-minute WAV is about 476 MB.

## Why the obvious fix fails

Adding the cleanup to that same value does not work:

```ts
useEffect(() => () => URL.revokeObjectURL(url), [url]);   // breaks everything
```

React StrictMode mounts an effect, tears it down, then mounts it again. The
teardown revoked the URL while the card was still alive. Measured result: every
waveform stopped at "Preparing audio…" and the console filled with
`ERR_FILE_NOT_FOUND`.

## The work

1. Create **and** revoke the URL inside one effect, so the live URL is always the
   one that effect owns. That means the first render has no URL to give
   wavesurfer, so decide what the card shows until the effect runs.
2. Confirm under StrictMode in the dev build, not only in the production build.
   The production build does not double-invoke effects, so it hides this class
   of defect.
3. Measure the memory held by ten loaded tracks, before and after. Note
   [baselines](../baselines.md) finding 6: `performance.memory` does not count
   audio, so read the browser's own per-tab memory instead.

## Watch for

[007 — Design the worker boundary](./007-design-the-worker-boundary.md) must
state a memory ceiling as a number. That number depends on this: whether a track
that is loaded but idle still costs its whole file.

## Acceptance

Removing a track releases its audio. Every waveform still loads, in the **dev**
build with StrictMode on.
