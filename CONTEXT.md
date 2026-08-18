# SoundSlice

A browser-only tool for cutting audio files into shorter files. Audio never
leaves the browser: no upload, no server, no account.

## Language

### The workspace

**View**:
Which set of controls is on screen. One of Simple view or Advanced view.
_Avoid_: mode, level, tier

**Simple view**:
The view for quick edits. One region per track and a small set of switches.
_Avoid_: basic mode, lite

**Advanced view**:
The view for people with audio knowledge. Many regions, effects, and export
options. Always free.
_Avoid_: Pro, expert mode, premium

**Theme**:
Light or dark appearance. This is what `mode` means in the existing code.
_Avoid_: colour scheme

### The work

**Track**:
One audio file the user has loaded. Each track has its own card and its own
waveform.
_Avoid_: file, clip, stem, lane

**Region**:
A start and end point on a track, marking audio to be cut out. Simple view
allows one per track. Advanced view allows many.
_Avoid_: selection, clip, range, marker

**Slice**:
The act of exporting a region as its own file.
_Avoid_: trim, cut, render, bounce

**Operation**:
One reversible change recorded against a track, such as a trim, a fade, or an
EQ setting.
_Avoid_: effect, step, action

**Edit stack**:
The ordered list of operations held against a track. Nothing is applied to the
audio until export replays the stack.
_Avoid_: pipeline, chain, history

**Master defaults**:
Settings on the master toolbar that apply to every track unless that track
overrides them.
_Avoid_: global settings, presets

### The sound

**Loudness**:
Perceived volume measured in LUFS, per ITU-R BS.1770. This is what the
"Normalize Levels?" switch targets.
_Avoid_: volume, level, gain

**Peak normalization**:
Scaling audio so its single loudest sample reaches full scale. Distinct from
loudness. Two tracks can share a peak and sound very different.
_Avoid_: normalize (unqualified)

**Noise profile**:
A frequency measurement taken from a region the user marks as silent, used to
subtract that noise from the whole track.
_Avoid_: noise floor, sample

### The output

**Join**:
Combining regions from any track into one output file, with crossfades between
them.
_Avoid_: arrange, concatenate, merge, sequence
