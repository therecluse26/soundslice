# 032 — Split at transients, and where region tool settings live

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *Split at transients* and *Where the
region tools' own settings live*, graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Two items. **Split at transients** — one region per hit — was kept apart from
ticket 026 because "snap" is a magnet on a drag and this is detect-then-cut,
the shape of ticket 025. And the region tools' own settings (`snapToTransients`,
the split-on-silence numbers) survived a view switch but not a reload, because
`MasterDefaults` holds what an export is made of and these change no file.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| Onset detection | **Ticket 026's**, unchanged. One detector, two tools. |
| Region shape | One region per onset. It starts **10 ms before** the attack and runs to the next onset, so a join of them plays the file back. |
| Fades | 5 ms in, so the attack stays sharp; 10 ms out. |
| Shortest region | 100 ms by default. A closer onset is merged into the one before it. |
| Settings | **Shortest region** and **Start before hit**, in the tool's popover. |
| Replace or add | Replaces every region on the track, as one gesture. The popover says so, and says Ctrl+Z puts them back. |
| Where tool settings live | **A preference of their own**, `region-tools` in localStorage, version 1. Not master defaults, and not project work. A working mode is how *you* work, not what *this file* is. |

## Resolution

`regionsFromOnsets` and `clampSplitSettings` in `src/lib/transient-split.ts`;
`src/lib/region-tool-prefs.ts` holds the preference with a type guard, so a
damaged record falls back to defaults rather than throwing.

**Checked in the browser:** `hits.wav` (a hit every 0.5 s) gave **11 regions**,
the first at 0.490–0.990 s with fades of 5 and 10 ms, as one entry labelled
"Split at transients".
