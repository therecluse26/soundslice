# 030 — Undo covers files and the master toolbar

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *What else undo covers* and *Removing
one track*, graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Ticket 024's command history recorded region gestures and nothing else. Adding
a file, removing a track and changing a master default could not be undone,
and there was no way to remove a track at all — three tickets (015, 016, 017)
had wanted one.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| What undo covers now | Region gestures, the edit stack, **adding files, removing a track, and every master default**. |
| One history or several | Still one, for the whole project. |
| Removing a track | A ✕ beside the file name. Undo brings the track back **with all its work**: regions, stack, overrides, join layout. |
| Adding files | One drop is one gesture, however many files: "Add 2 files". |
| The `File` objects | A history entry holds the `File`, not its audio. A file kept only by history counts against ticket 007's ceiling, so the admission check counts it, and a refusal says so. |
| Where undo lives on screen | **Undo and Redo buttons in the header**, labelled with what they would reverse — "Undo Add 2 files". Ctrl+Z and Ctrl+Shift+Z as before. |
| Sliders | One drag is one entry, through a `coalesceKey` changed on pointer up. Keyboard steps commit on each key, as the loudness slider already did. |

## Resolution

`applyHalf` in the store restores three things in one step: the file list, the
master defaults and the tracks. Master setters go through one `setMaster(key,
value, options)` so each change carries a label.

**Checked in the browser:** two files added as one entry; remove `hits.wav`,
Ctrl+Z, and it returns with its region; set MP3, undo, and the format reads WAV
again. The header button read "Undo Add 2 files".

**A defect found on the way, not caused by this ticket.** Resizing the window
past the 800 px phone breakpoint rebuilt every waveform, because its height and
bar width are wavesurfer options and any option change rebuilt the instance. A
rebuilt instance has no audio until it decodes again, so the card redrew its
regions onto a 0-second waveform, the regions plugin clamped each one to 0–0,
and the card wrote that back to the store as the truth. **Turning a phone
sideways erased the user's regions**, with duplicate ids. Fixed twice over:
`useWavesurferInstance` now rebuilds only when the file or the plugins change and
restyles the live instance with `setOptions`; and the card never writes a clamp
back while the duration is 0. Checked: 1400 → 700 → 1400 px keeps both tracks'
regions and ids.
