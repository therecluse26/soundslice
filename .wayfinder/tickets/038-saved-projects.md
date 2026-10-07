# 038 — Saved projects

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *Saved projects — OPFS schema, what is
stored, when it is evicted*, graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Close the tab and every region is gone. What is stored, where, and when is it
thrown away?

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| What is stored | **The work, never the audio.** Regions, stack, export overrides, join layout. The user still has the file; storing it would put a 45-minute WAV in the browser for nothing. |
| Where | **localStorage**, key `projects`, version 1. Not OPFS: the work is a few kilobytes of JSON, and OPFS buys nothing at that size. |
| The key | `name:size`. A file is recognised when it is dropped again. |
| When it saves | **Automatically**, 500 ms after the last change, and on `pagehide`. Only when the work differs from the track's **baseline** — what it looked like when it was loaded — so an untouched file saves nothing. |
| Eviction | Least recently used, at **100 entries** or **2 000 000 characters**. |
| Restore | Silent, when the file is dropped again. The card says "Restored from your last session" with **Start fresh**, which is one gesture and can be undone. |
| A record it cannot read | An unknown version or an unknown operation **discards the record**. Half a project is worse than none. |
| Region ids | Minted again on restore, with the selection, the join order and the crossfades remapped, so a restored id can never collide with a live one. |
| A file to keep | **Save** and **Open** on the master toolbar, as `*.soundslice.json`. Open applies to every track whose file is loaded and reports the rest as missing. |

## Resolution

`src/lib/saved-project.ts`, `src/lib/work-signature.ts` and
`src/lib/project-autosave.ts`, all lazy, so none of it is in Simple view's first
load. A noise profile is stored as base64.

**Checked in the browser:** an untouched track left `projects` empty. Eleven
regions and a gain block saved 1 371 characters and came back after a reload,
with the note. Start fresh returned one region, emptied the record, and Ctrl+Z
brought the work back. Save downloaded `soundslice-project.soundslice.json`;
Open put 11 regions back over 1, said "Opened 1 track.", and was one undo entry.
