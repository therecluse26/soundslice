# 009 — Replace the store's ref and rerender hack

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-18 (store rewrite)
**Blocked by:** none — was
[003 — Design the view state model](./003-design-the-view-state-model.md), closed
2026-08-18
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can the store hold real reactive state instead of refs plus a forced redraw?

This is the third of the three known defects.

`src/stores/audio-store.ts` keeps everything in `MutableRefObject` wrappers.
Zustand cannot see writes to a ref, so nothing redraws. The workaround is
`triggerRerender: () => set({ rerender: Math.random() })` at line 86, called
from `src/pages/Dashboard.tsx:16`, where the comment reads "dumb hack to work
around updating above refs, but it works".

It works for Simple view, which has four settings. Advanced view has per-track
EQ, many regions, undo history, and per-track overrides. A random-number redraw
will not hold that, and it redraws every track when one changes.

The work:

1. Move `tracks`, `normalizeAudio`, `applyPostProcessing`, `trimSilence` and
   `exportFileType` into real store state.
2. Remove `rerender` and `triggerRerender`.
3. Make each `AudioEditor` subscribe only to its own track, so editing track
   three does not redraw track one. `AudioEditor` is already `React.memo`, but
   the current store defeats it.
4. Carry the view state model from ticket 003.

## Watch for

The `Region` object from wavesurfer is stored directly on `EditorTrack` at
`src/stores/audio-store.ts:8`. That is a live object owned by the wavesurfer
plugin, not plain data. Putting it in reactive state may cause loops or stale
reads. Store plain start and end numbers instead, and keep the plugin object out
of the store.

There is a known re-render sizing issue, fixed in commit `2027494`, and a
`requestAnimationFrame` resize loop at `src/components/custom/AudioEditor.tsx:113`
that runs every frame forever. Check whether fixing the store lets that loop be
replaced by a `ResizeObserver`.

## Acceptance

Redraw counts drop. Editing one track's settings redraws one card, not all of
them. Simple view behaves exactly as before.

---

## Resolution — 2026-08-18

Yes. The store holds real state. `rerender` and `triggerRerender` are gone.

Adding one file to three already loaded used to cost **48 renders**. It now
costs **12**, and no existing card redraws at all.

### What changed

| File | Change |
|---|---|
| `src/stores/audio-store.ts` | rewritten: real state, no fake refs, no forced redraw |
| `src/lib/master-defaults.ts` | new: the master settings object, its storage key and its guard |
| `src/lib/render-count.ts` | new: a dev-only render counter, so redraws can be measured |
| `src/pages/Dashboard.tsx` | subscribes to the **files**, not the tracks |
| `src/components/custom/AudioEditor.tsx` | takes a `file` prop, selects its own track, `ResizeObserver` |
| `src/components/custom/MasterToolbar.tsx` | one selector per setting; the four `Select`s are controlled |
| `src/lib/audio-service.ts` | `sliceAllFilesIntoZip` takes an array; `sliceAudio` reads `track.region` |
| `src/lib/advanced-settings.ts`, `AdvancedSettingsChip.tsx`, `src/bench/main.ts` | follow the renamed field |

`EditorTrack.selectedRegion` — the live wavesurfer `Region` — is now
`EditorTrack.region`, of type `{ start: number; end: number }`. The plugin object
never leaves `AudioEditor`, as this ticket required.

### Who subscribes to what

| Component | Subscribes to | Redraws when |
|---|---|---|
| `Dashboard` | the file list, via `useShallow`; `processingLoading` | a track is added or removed |
| `AudioEditor` | its **own** track, found by file name | that one track changes |
| `MasterToolbar` | the four master settings | a master setting changes |
| `AdvancedSettingsChip` | the **count**, not the array | the number changes |

`AudioEditor` takes a `file` prop, not a track. The store keeps the same `File`
object across a merge, so the prop never changes identity and `React.memo`
blocks every redraw driven by the parent. Export settings are read at click time
from `getState()`, so no card subscribes to them.

### Redraws, measured

Chromium, dev build, React StrictMode on — so every count is doubled, before and
after alike. Three 30-second tracks loaded and settled, counter reset, one action.

| Action | Before | After |
|---|---|---|
| move a region | **nothing redraws** — the store never learns | 1 card |
| resize a region | 1 card | 1 card |
| change a master switch | **nothing redraws** — the change is invisible | the toolbar, and **no** cards |
| add a fourth file | **48 renders** | **12** |

Adding a file, broken down:

| Component | Before | After |
|---|---|---|
| `Dashboard` | 2 | 2 |
| `MasterToolbar` | 4 | 2 |
| `AudioEditor:one.mp3` | 12 | **0** |
| `AudioEditor:two.mp3` | 12 | **0** |
| `AudioEditor:three.mp3` | 12 | **0** |
| `AudioEditor:four.mp3` | 6 | 8 |
| total | **48** | **12** |

The first two rows of the action table are the defect at its plainest. Before
this ticket, dragging a region and changing a master switch redrew **nothing**,
because both wrote to a ref.

### A second defect, found while measuring

Four distinct files produced **seven** cards: `one, two, three, one, two, three,
four`. `BrowserMultiFileUpload` keeps every upload it has ever accepted and
re-sends the whole list, and `setTracks` appended it wholesale. So dropping one
new file duplicated every track already loaded.

`setTracks` now merges on file name. Four files give four cards. It also keeps
the track object already in the store, so **regions survive a second drop** —
verified in production: a region edited to `00:25` stayed at `00:25`, and its
waveform did not reload.

Two different files with the same name still collide. That was already true of
`getTrack`, and it is not this ticket's to fix.

### Simple view is unchanged, and proved so

**Byte-identical output.** `clip-30s.mp3`, whole track, WAV, all four switch
combinations, FNV-1a hashed. Commit `741dc1f` and this commit were served side by
side and run with the same script.

| Normalize | Post-processing | Bytes | `741dc1f` | After |
|---|---|---|---|---|
| No | No | 5760044 | `52293c2a` | `52293c2a` |
| No | Yes | 5760044 | `52293c2a` | `52293c2a` |
| Yes | No | 5760044 | `9363d914` | `9363d914` |
| Yes | Yes | 5760044 | `aa577189` | `aa577189` |

Standing rule 1 holds. Rows one and two still collide, which is
[013 — Post-processing switch does nothing unless normalize is on](./013-post-processing-guard-defect.md),
untouched here.

These hashes differ from the ones ticket 013 recorded, because the hash function
is not the same one. The byte counts and the collision pattern match exactly, and
the two commits agree, which is what standing rule 1 asks.

**Not slower.** Medians of three runs, same machine, same browser session.

| Case | `741dc1f` | After |
|---|---|---|
| decode, 30 s | 119.2 ms | 115.2 ms |
| slice switches off, 30 s | 221.6 ms | 220.0 ms |
| slice processed, 30 s | 391.5 ms | 396.5 ms |
| decode, 5 min | 1177.3 ms | 1124.6 ms |
| slice switches off, 5 min | 2073.4 ms | 2037.5 ms |
| slice processed, 5 min | 3772.8 ms | 3681.3 ms |
| export WAV, 5 min | 544.7 ms | 559.0 ms |
| export MP3, 5 min | 3639.2 ms | 3643.4 ms |
| batch, 10 × 30 s | 2190.5 ms | 2223.8 ms |

Every difference is inside run-to-run noise. The DSP was not touched.

### Dropping a file now costs half as much

Counted in the production build, per file dropped:

| | [Baselines](../baselines.md) | After |
|---|---|---|
| `decodeAudioData` calls | 2 | **1** |
| offline renders | 1 | **0** |
| time to first waveform, 30 s | 864.2 ms | 689 ms |

`AudioEditor` used to call `audioService.loadFile`, which decoded the whole file
into a private `buffer` that nothing ever read — the export path calls the
**static** `AudioService.sliceAudio`, which decodes again. Baselines finding 3
and `designs/view-state.md` fact 3 both recorded this. The call is gone.

`AudioService.loadFile`, `createDownloadLink` and `sliceAudioViaWorklet` now have
no callers at all.
[008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
removes them; deleting engine surface is not this ticket's job.

### The requestAnimationFrame loop is gone

`AudioEditor` polled `clientWidth` in a `requestAnimationFrame` loop that ran
every frame, forever, once per track. It is now a `ResizeObserver` on the
container. The width guard stays, because setting the width resizes the canvas
and would otherwise call the observer straight back.

### The bundle

Both commits built with the same Vite on the same machine.

| Asset | `741dc1f` | After | Change |
|---|---|---|---|
| `index.js` raw | 502.48 KiB | 503.65 KiB | +1.17 KiB |
| `index.js` gzip | 154.75 KiB | 155.13 KiB | **+0.38 KiB** |
| `index.css` gzip | 6.00 KiB | 6.00 KiB | 0 |
| `AdvancedPanel.js` gzip | 2.62 KiB | 2.63 KiB | +0.01 KiB |

The growth is `useShallow`, the merge, and persisted master defaults. It is all
behaviour, none of it measurement: `__renders`, `countRender`, `AudioEditor:` and
`event:region-updated` each appear **zero** times in the production bundle. The
counter costs nothing, because every call site is written
`if (import.meta.env.DEV) countRender(…)` and Vite folds that to `false`.

[014 — The whole Tailwind config ships in the Simple bundle](./014-tailwind-config-in-simple-bundle.md)
remains the available offset.

### Master defaults now persist

`.wayfinder/designs/view-state.md` section 7 asked for this, and ticket 012 could
not deliver it while the settings were refs. They are written to
`soundslice:master-defaults` as `{"v":1,"value":{…}}`, guarded on read, and
discarded rather than migrated if the version is unknown. Verified: Normalize set
to Yes, page reloaded, a file dropped, the switch reads **Yes**.

The four `Select` controls are now controlled rather than uncontrolled, so they
show the stored value instead of their own.

### Ticket 012 still passes

Re-checked on this production build:

| Acceptance | Result |
|---|---|
| the waveform does not move on a switch | **pass** — `top` 407 px in Simple, Advanced, and Simple again |
| a Simple user downloads no Advanced code | **pass** — no `AdvancedPanel` request |
| Advanced code loads on demand | **pass** — `AdvancedPanel.99b54357.js` on first switch |
| below 800 px the toggle hides and the view is Simple | **pass** — and the stored view stayed `advanced` |

### One step attempted and reverted

Revoking each track's blob URL on unmount **broke every waveform**. React
StrictMode mounts an effect, tears it down, and mounts it again, so the cleanup
ran while the card was still alive. Every card stopped at "Preparing audio…"
with `ERR_FILE_NOT_FOUND`.

The leak is real and still there: a track holds its audio for the life of the
page. Raised as
[015 — Track audio is never released](./015-release-track-audio.md), because the
fix changes how the card loads, not how the store works.
