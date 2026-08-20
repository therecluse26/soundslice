# 023 — Export many regions

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [021 — Many regions per track](./021-many-regions-per-track.md)
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

One track now produces many files. What are they called, how are they delivered,
and what does a ten-track batch do?

## Decided in grilling, 2026-08-20

| Case | Answer |
|---|---|
| One region | keeps today's name exactly: `sliced_clip-30s.wav`. **No suffix.** |
| Many regions, unnamed | `sliced_clip-30s_1.wav`, numbered **by start time** |
| Many regions, named | `sliced_clip-30s_chorus.wav` |
| Card's Slice Audio, one region | downloads the file, as today |
| Card's Slice Audio, many regions | **one zip** |
| Simple view | exports the first region by start time only, unchanged |
| Zero regions | exports nothing, and does not report success |

**Why the stem stays.** With twelve files you must still see which source each
came from. **Why one region keeps today's name.** Nothing that works today
changes, which is standing rule 4.

## Where this starts

`src/lib/file-names.ts`. `stemOf`, `outputFileName` and `uniqueFileName` are
plain string functions with tests, so this is testable in Node.

`uniqueFileName` already gives ` (2)` on a clash, because
[016](./016-export-empties-track-list.md)-era testing found JSZip overwriting
silently and losing files.

## What to weigh

1. **A region name is user text.** It can hold `/`, `:`, a trailing dot, or a
   null byte. Sanitising is required, and `uniqueFileName` does not do it.
2. **Two regions on one track named the same.** ` (2)` is the right answer, but
   only if the caller shares one `taken` set across the whole export.
3. **Numbering by start time means a moved region changes its number.** Say so
   plainly, or number by creation instead. Simple view already chose
   first-by-start-time for the same reason: it is visible and stable to the user.
4. **The zip's own name**, for one track with many regions.

## Watch for

- **Ticket 007's rule.** The export stays serial, and the 1 GB ceiling counts
  everything loaded.
- **Ticket 016's rule.** An empty list does not report itself complete.
- **Ticket 018's rule.** [`download.ts`](../../src/lib/download.ts) is the only
  place an export blob URL is created, and it revokes every one.
- **Progress must count regions, not tracks.** Six regions on ten tracks is sixty
  renders, and a bar that counts ten will sit at 10% for a long time.

## Acceptance

- A one-region track exports **byte-identical bytes and an identical filename**
  against commit `b690dbb`.
- A six-region track gives six files in one zip, each named correctly and each
  holding its own audio — checked by decoding them, not by reading the names.
- Two regions named the same give ` (2)`, and **no file is missing from the zip**.
- A name holding `/` produces a valid filename that opens.
- A ten-track, sixty-region batch shows progress that reaches 100% exactly once.
- `pnpm test` covers the naming rules as plain string functions.
