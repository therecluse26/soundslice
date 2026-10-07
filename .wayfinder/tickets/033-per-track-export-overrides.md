# 033 — Per-track export overrides

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-10-06
**Blocked by:** none — was the map's fog *Per-track export overrides* and
*Advanced panel layout for the Export section*, graduated 2026-10-06

**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Bit depth, sample rate and output format were master defaults, and a track
could not disagree with them. Ticket 003 built the mechanism. What a per-track
override means for a batch that then produces four formats in one zip was not
decided.

## Decided in the build session, 2026-10-06

Not grilled with the user. Each decision below is reversible.

| Question | Answer |
|---|---|
| What a track may override | Output format, bit depth, sample rate. |
| Storage | `ExportOverrides`, a partial. A missing field is **inherited**. `{}` is stored as no overrides at all, so "has overrides" has one meaning. |
| A zip of mixed formats | Allowed. Each file is named with its own extension. The zip is a folder, and a folder may hold a FLAC beside a WAV. |
| Join everything | Uses the master format and **ignores** overrides, because one file has one format. The Export section says so while that mode is on. |
| The layout | Each field reads "Master (WAV)" until it is changed. **Reset to master** clears the track's overrides. **Copy to all tracks** is ticket 031. |

## Resolution

`effectiveExportSettings` in `src/lib/track-work.ts` merges master and track.
`settingsFor(track, master)` in the audio service is the one place an export
asks. `src/components/custom/advanced/ExportFields.tsx` holds the three fields,
shared by the master toolbar and the card, so the two can never offer different
choices.

**Checked in the browser:** a track overriding to FLAC under a WAV master
exported `sliced_hits.flac`.
