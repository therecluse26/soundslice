# 031 — Copy to all tracks, and Clear Advanced settings

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *"Copy settings to all tracks"*,
graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Ticket 003 settled the mechanism: copying writes the source's **effective**
settings into every other track as overrides, and Reset gives one back. What
was left was the contents — which operations copy and which do not — and the
gesture the design used to argue for one command history: **Clear Advanced
settings**.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| Sound: what copies | The whole effective stack **except noise reduction**. A noise profile is measured on one recording; on another it subtracts the wrong noise. A target track keeps its own noise reduction, if it has one. |
| Export: what copies | The track's export overrides — format, bit depth, sample rate. |
| Where the buttons are | "Copy to all tracks" in the Sound section and in the Export section of each card. |
| What Clear removes | Everything the Advanced settings chip counts: every track's stack, export overrides and join layout; every region but the first, and that one's stretch. |
| What Clear keeps | The first region of each track, so Simple view still has a selection. Master format stays MP3 if it was MP3, else WAV. Depth, rate, join mode and loudness return to master defaults. |
| Undo | Clear is **one** gesture across every track, and one Ctrl+Z restores all of it. |

## Resolution

`copySoundToAllTracks`, `copyExportToAllTracks` and `clearAdvancedSettings` in
the store, each one history entry through `editEveryTrack`.

**Checked in the browser:** with 11 regions, a join layout, a gain block and
"one file per track", the chip read "3 Advanced settings active". Clear left one
region with no stretch, no stack, no join layout and join mode `separate`; the
chip disappeared. One Ctrl+Z brought back the 11 regions, the gain block and the
join mode.
