# 021 — Many regions per track

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none
**Blocks:** [022 — The region list and its gestures](./022-region-list-and-gestures.md),
[023 — Export many regions](./023-export-many-regions.md),
[024 — Build undo: the command history](./024-build-undo-command-history.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

A track holds one region. Advanced view needs many. What is the model, and what
does every existing reader do when a track has none, or six?

## Where this starts

`EditorTrack.region?: TrackRegion` — `src/stores/audio-store.ts:46`. One region,
optional, with no identity of its own.

Six files read it outside the tests:

| File | What it does with the region |
|---|---|
| `src/stores/audio-store.ts` | owns it; `setTrackRegion` merges bounds into it |
| `src/lib/audio-service.ts` | measures it, renders it, and filters tracks by it |
| `src/hooks/usePreview.ts` | schedules its envelope |
| `src/components/custom/AudioEditor.tsx` | draws it, writes it, restores it on mount |
| `src/lib/advanced-settings.ts` | counts it for the Advanced chip: `track.region ? 1 : 0` |
| `src/bench/main.ts` | builds one with `defaultRegion` |

## Decided in grilling, 2026-08-20

| Decision | Answer |
|---|---|
| Regions per track | many |
| Overlap | **allowed.** Two takes of one phrase is a real thing to want. |
| Zero regions | **allowed.** The track exports nothing and the card says so. |
| Region name | **optional.** Empty falls back to its number by start time. |
| Simple view | draws and exports the **first region by start time**, unchanged |
| Simple view with zero regions | never happens. Simple always keeps one. |
| Selection | one region per track is selected. The play button plays it. |

The chip rule from [`designs/view-state.md`](../designs/view-state.md) §4 stands
and is not reopened: hidden regions survive a view switch, and the chip naming
them is not dismissible.

## What to weigh

1. **Identity.** wavesurfer's `RegionParams` carries an `id`, and the plugin
   mints one when you do not. Does the store take that id, or mint its own?
   Taking wavesurfer's couples the store to a view library. Minting our own means
   a map in both directions.
2. **`regions: Region[]` or `regions: Record<string, Region>`.** Order by start
   time is derived either way, because a drag can reorder them at any moment.
3. **Migration shape.** Does `region` survive as a computed accessor while the
   six readers change one at a time, or do they all change at once?
4. **Where selection lives.** On the track, or in a separate `selectedRegionId`
   map? A track owning it makes selection survive a view switch for free.

## Watch for

- **`advanced-settings.ts:93` returns 1 or 0.** With many regions the Advanced
  chip's count means something different. Decide what it says.
- **`audio-service.ts:277` filters `tracks.filter((track) => track.region)`.**
  Zero regions must not become a silent skip that then reports success. That is
  the shape of the defect [016 — "Slice All Files" empties the track list](./016-export-empties-track-list.md)
  fixed.
- **Ticket 017's rule still holds.** A card restores the stored regions on mount,
  and uses the 1–100 default only for a track that has none.
- **Two different types are called `Region`.** `src/lib/edit-stack.ts` exports
  ours; wavesurfer's regions plugin exports its own. `AudioEditor` already
  imports both and must keep them apart.

## Acceptance

- A track holds six regions, and every one survives a remount, digit for digit.
- Two regions overlap, and both render their own audio.
- Deleting the last region leaves zero. The card says the track exports nothing,
  and no export path throws or reports false success.
- Simple view still draws and exports the first region by start time, and the
  chip still names the hidden ones.
- **Simple view's exported bytes are unchanged for a one-region track**, proved
  against commit `b690dbb`.
- `pnpm test` passes, and covers the ordering rule and the zero case.

## Resolution — 2026-08-20

**Built.** `EditorTrack.region?: TrackRegion` is gone. A track holds
`regions: TrackRegion[]` and a `selectedRegionId`, and all six readers changed
at once rather than behind a compatibility accessor.

### The model, and the four things weighed

| Question | Answer | Why |
|---|---|---|
| Identity | a `Region.id`, minted by `newRegionId` | a track holds many and they may overlap, so bounds cannot identify one |
| One id or two | **one.** The store's id **is** the wavesurfer region's id | `RegionParams.id` is taken verbatim by the plugin, checked in its source. The store hands its id down; a region the user drew is adopted with the id the plugin minted. No map, and no stale half of one |
| Array or record | `Region[]` | order is derived from start time by `orderedRegions`. A drag can move a region past its neighbour at any moment, and an array that had to be resorted on write is one more thing to forget |
| Migration | all at once | a computed `region` accessor would have left two truths for as long as it lived |
| Selection | on the track | it survives a view switch for free, and `selectedRegion` falls back to the first by start time, so a track nobody has clicked behaves exactly as it did before |

Ids are a counter — `ss-region-1`, `ss-region-2` — not `crypto.randomUUID`. The
counter is readable in a test failure, and `edit-stack.ts` must stay loadable
under plain Node, which is `dsp.ts`'s rule one file over. The `ss-` prefix keeps
it out of the plugin's own `region-<random>` space.

### The three "watch for" items

- **`advanced-settings.ts` now reads `track.regions.length`.** The chip's rule
  did not change: **more than one region anywhere counts one**, not one per
  region. Measured with six regions on a track: the chip reads **1**.
- **`audio-service.ts` no longer filters tracks by region.** It plans
  `(track, region)` pairs, and a track with none contributes nothing. A zero-region
  export returns an empty plan, `sliceTrack` returns `null`, the zip comes back
  **22 bytes** — an empty zip — and nothing reports success. The card says
  "No regions — this track exports nothing."
- **Two types named `Region` are still kept apart.** `AudioEditor` imports ours
  from `edit-stack` and wavesurfer's from the plugin, as before.

One thing the measurement cache had to learn: **`measurementKey` keys on
`regionAudioSignature`, not on the region.** An id and a name change no sample,
and keying on the whole object would have thrown a loudness measurement away
every time a user typed a letter into the name field — each one costing a full
decode to make again.

### Measured

- **Six regions survive a real remount, digit for digit** — ids, awkward floats
  (`0.1234567890123`, `8.218351477449454`), names and per-region gains all
  identical before and after the card was destroyed and rebuilt.
- Two regions overlap and both render their own audio, checked by decoding the
  exported files rather than by reading their names.
- Deleting the last region leaves zero. No export path throws, and none reports
  success.
- Simple view draws and exports the first region by start time; with six regions
  the chip reads "5 regions hidden".
- **Simple view's exported bytes are unchanged against commit `b690dbb`.** Both
  trees run side by side and hash the same 5,292,044 bytes:
  switches off `99fbd8ef…07a7`, switches on `f32d6274…0c7e`. The filename is
  `trimmed_clip-30s.wav` in both.
- `pnpm test` 186 → 295, covering the ordering rule, the tie-break, the zero case
  and the audio signature.
