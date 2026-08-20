# 023 — Export many regions

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-20
**Blocked by:** none — was [021 — Many regions per track](./021-many-regions-per-track.md), closed 2026-08-20

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

## Resolution — 2026-08-20

**Built.** `regionFileName` in [`file-names.ts`](../../src/lib/file-names.ts) is
the one place that decides a name, and `AudioService.planSlices` is the one place
that makes it unique.

### The names, measured out of a real zip

| Case | Name |
|---|---|
| the track's only region | `sliced_hits.wav` — **no suffix** |
| one of many, unnamed | `sliced_phrases_1.wav` … `sliced_phrases_7.wav` |
| one of many, named | `sliced_phrases_chorus.wav` |
| two regions named the same | `sliced_phrases_chorus (2).wav` |
| a name holding `/` | `sliced_phrases_verse-one.wav` |

### The four things weighed

1. **A region name is user text**, so `sanitizeNamePart` runs first. `/` and `\`
   would make a directory; `:` names a drive on Windows and a resource fork on
   macOS; `<>"|?*` are refused outright; a control character or a null byte can
   truncate the name where it is used. Every one becomes `-`. Leading and trailing
   dots and spaces go too, because Windows strips a trailing dot silently and two
   names would become one file. Capped at **64 characters**, so the path can still
   be written.
   A name carrying **no letter and no digit in any script returns `""`** and falls
   back to the number: `///` would otherwise come back as `---`, which reads as a
   bug rather than as a name.
2. **One `taken` set across the whole export**, owned by `planSlices`. Two tracks
   that each hold a region called "chorus" both arrive.
3. **Numbering is by start time, and a moved region renumbers.** Said plainly in
   the code and in the list: the number matches what the card shows, and a hidden
   creation order the user cannot see would be worse. A user who wants a stable
   name gives the region one.
4. **The zip's own name** for one track with many regions is
   `trimmed_<stem>.zip`.

### Progress counts regions, not tracks

`planSlices` builds every output **before** any of them renders, so `fileCount` is
the region count from the first report. Measured on two tracks holding 7 and 1
regions: `fileCount: 8`, eight distinct file indices, **326 reports, none of which
goes backwards**, running 0.0031 → 1.

### Measured

- A one-region track exports **byte-identical bytes and an identical filename**
  against commit `b690dbb`: 5,292,044 bytes, `99fbd8ef…07a7` switches off and
  `f32d6274…0c7e` switches on, named `trimmed_clip-30s.wav`.
- A seven-region track gives seven files in one zip, **checked by decoding them**:
  1.1 s, 1.2 s × 5, 0.5 s, each peaking at 0.5 — the regions exactly.
- Two regions named the same give ` (2)`, and the zip holds both.
- A name holding `/` produces a valid filename that opens.
- `pnpm test` covers the naming rules as plain string functions, including the
  character class that a lazy `[\x20-\x3c…]` range would have used to eat every
  digit.
