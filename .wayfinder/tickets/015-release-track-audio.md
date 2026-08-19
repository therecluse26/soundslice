# 015 — Track audio is never released

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-19 (build sweep)
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

---

## Resolution — 2026-08-19

**Yes.** A card now releases its audio when it goes away, and every waveform
still loads in the dev build with StrictMode on. Ten tracks released **505.9 MB**.

### The fix

One effect owns both halves of the URL's life:

```ts
const [url, setUrl] = useState<string | undefined>(undefined);

useEffect(() => {
  const objectUrl = URL.createObjectURL(file);
  setUrl(objectUrl);
  return () => URL.revokeObjectURL(objectUrl);
}, [file]);
```

The cleanup revokes `objectUrl`, the URL **that effect created** — not whatever
is in state now. That is the whole difference from the version that failed. A
`useMemo` plus a separate cleanup effect revokes by looking the URL up, and under
StrictMode the value it looks up belongs to the run that is still alive.

The first render has no URL. wavesurfer treats a missing `url` as nothing to
load and waits — `wavesurfer.js/dist/wavesurfer.js:59` computes
`options.url || getSrc() || ''` and skips the load when the result is empty. The
card already shows "Preparing audio…" until wavesurfer reports ready, so nothing
new appears on screen.

### Proof, in the dev build with StrictMode on

Every `URL.createObjectURL` and `URL.revokeObjectURL` call was recorded through a
page init script, then three files were loaded.

**On load** — StrictMode mounts, tears down, mounts again:

| | Count |
|---|---|
| URLs created for track files | 6 — two per card |
| URLs revoked | **3** — the first of each pair |
| Still alive | **3** — one per card, the one wavesurfer holds |

That is the exact shape the old code got wrong. It revoked the survivor.

**The waveforms drew.** 3 shadow roots, 12 canvases, 1285 px wide, no "Preparing
audio…" left on screen, and **zero console errors** — no `ERR_FILE_NOT_FOUND`.

**On unmount.** Exporting replaces the whole card list with the loader
(`Dashboard.tsx:39`), so every card unmounts for real. After that:

| | Count |
|---|---|
| URLs created, total | 16 |
| URLs revoked | 15 |
| Track URLs still alive | **0** |

### The memory number

`performance.memory` does not count blob data — baselines finding 6 — so this is
the Playwright Chromium tree's RSS read from `/proc`, with
`HeapProfiler.collectGarbage` forced through CDP before each reading. Steam also
runs Chromium on this machine, so only processes matching
`ms-playwright/chromium-1212` were counted.

Ten `track-5m.wav` Files, 50.4 MB each, 503.9 MB in total. The `File` references
were dropped, so only the blob URL kept the data alive.

| State | Chromium RSS |
|---|---|
| Before | 1252.7 MB |
| Ten URLs created, `File` refs dropped, GC forced | 1525.6 MB |
| The same ten URLs revoked, GC forced | **1019.7 MB** |

**Revoking released 505.9 MB** against 503.9 MB of file data — one for one. The
end state is below the start because the start still held the fetch buffer that
the ten Files were built from. The three readings after the revoke were 1019.7,
1019.6 and 1019.6 MB, so this is settled memory, not a sampling artefact.

### For ticket 007

[007 — Design the worker boundary](./007-design-the-worker-boundary.md) has to
state a memory ceiling as a number, and asked whether a loaded but idle track
still costs its whole file.

**It does, exactly, one for one, until the card unmounts.** So the ceiling must
count the encoded file **plus** the decoded buffer for every track whose card is
on screen. It no longer has to count files whose cards are gone.

### What is still not released

The decoded `AudioBuffer`. `AudioService.sliceAudio` decodes fresh on every
export and lets the result go, so nothing accumulates there. This ticket was only
ever about the encoded file that the blob URL pinned.

### A defect found on the way

Exporting all files empties the track list. Raised as
[016 — Slice All Files empties the track list](./016-export-empties-track-list.md).
It is not caused by this change and predates it.
