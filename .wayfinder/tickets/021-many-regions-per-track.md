# 021 — Many regions per track

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
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
