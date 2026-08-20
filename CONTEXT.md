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

**Effective view**:
The view actually in force. On a screen under 800 px it is always Simple,
whatever the user chose. The view they chose is never overwritten.
_Avoid_: current view, resolved view

**Chip**:
A small label that tells a Simple view user about something Simple cannot show,
such as regions that will not be exported. A chip cannot be dismissed.
_Avoid_: badge, pill, banner, toast

### The work

**Track**:
One audio file the user has loaded. Each track has its own card and its own
waveform.
_Avoid_: file, clip, stem, lane

**Region**:
A start and end point on a track, marking audio to be cut out. Simple view
allows one per track. Advanced view allows many, and they may overlap. A region
also carries its own volume, fade edges, and time and pitch. It may carry an
optional name; without one it is known by its number, counted from the start of
the track.
_Avoid_: selection, clip, range, marker

**Selected region**:
The one region of a track that the play button plays. Clicking a region selects
it. Each track has its own.
_Avoid_: active region, current region, focus

**Region tool**:
A control that makes or moves regions. It never changes how the audio sounds, so
it is not an operation and it is not on the edit stack. Split on silence and
snap are the two. They live in a strip above the waveform.
_Avoid_: region effect, detector

**Gain line**:
The line drawn across a region, showing that region's own volume. Drag it up or
down. Top is loudest.
_Avoid_: volume line, envelope, fader

**Fade grip**:
The small square at a region's top corner. Drag it sideways to set that edge's
fade.
_Avoid_: handle, node, anchor

**Split on silence**:
The region tool that cuts a track into one region per non-silent stretch. It
drops the silence between them and replaces the track's existing regions.
_Avoid_: trim silence, auto-slice, detect

**Padding**:
The silence split on silence keeps at each end of a region, so the fade edges
ramp over silence instead of over the attack.
_Avoid_: margin, lead-in, handle

**Transient**:
A sudden rise in level, marking the start of a sound.
_Avoid_: onset, hit, peak

**Snap**:
The region tool that makes a dragged region edge land on a transient. It is a
magnet on a drag, not a button, and it makes no regions of its own.
_Avoid_: quantise, magnetise, align

**Slice**:
The act of exporting a region as its own file.
_Avoid_: trim, cut, render, bounce

**Preview**:
Hearing a region with its edit stack applied, before slicing it. What you hear
and what you export always match. The "Preview effects" switch turns the
track's effects off while listening, leaving volume and fades.
_Avoid_: monitor, audition, playback

**Operation**:
One reversible change recorded against a track, such as an EQ setting or a
compressor. Every region of that track gets it. A trim is **not** an operation:
the region already says which audio you want.
_Avoid_: effect, step, action

**Edit stack**:
The ordered list of operations held against a track. Nothing is applied to the
audio until export replays the stack.
_Avoid_: pipeline, chain, history

**Gesture**:
One change a user makes, from start to finish. A whole drag is one gesture, not
one per frame. It is the unit undo reverses.
_Avoid_: action, command, event

**Command history**:
The ordered list of gestures, kept so any of them can be reversed. One for the
whole project, not one per track.
_Avoid_: undo stack, journal, log

**Signal chain**:
The edit stack drawn as the path the audio takes, left to right, with a block
for each operation. It is a picture of the stack, not a second thing.
_Avoid_: rack, pipeline, routing

**Block**:
One operation in the signal chain, drawn as a tile. A block is switched on or
off, and opening it shows that operation's own control.
_Avoid_: node, module, slot, plugin

**Meter**:
A bar showing how loud the audio is right now. The bar is the average level and
the line above it is the loudest recent moment.
_Avoid_: VU, level indicator, scope

**Input meter**:
The meter at the start of the signal chain. It shows the region, with its own
gain and fades, before any operation. Elsewhere this is called dry.
_Avoid_: source meter, pre meter

**Output meter**:
The meter at the end of the signal chain. It shows what reaches the speakers,
and what an exported file will hold. Elsewhere this is called wet.
_Avoid_: master meter, post meter

**Clip**:
A sample that reaches or passes full scale. The meter warns about it, and the
warning stays lit after the sound has gone.
_Avoid_: overload, peak (unqualified), distortion

**Envelope**:
A setting whose value changes across a track, instead of holding one value.
Not built. This is the answer for per-moment control, so that regions never
become the place to put it.
_Avoid_: automation, keyframe, ramp

**Master defaults**:
Settings on the master toolbar that apply to every track unless that track
overrides them.
_Avoid_: global settings, presets

**Inherited**:
A setting taken from the level above — master to track, or track to region.
Change the level above and every inherited setting follows it.
_Avoid_: default, unset

**Override**:
A setting a track or region holds for itself, ignoring the level above.
Resetting it removes the override, and the setting is inherited again.
_Avoid_: custom, local, dirty

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

**Output format**:
Which kind of file a slice is written as. One of WAV, MP3, FLAC or Opus. Simple
view offers WAV and MP3. Advanced view offers all four. An Opus slice is written
into a WebM file, so it is named `.webm` and not `.opus`.
_Avoid_: file type, codec, container, encoding

**Bit depth**:
How many bits hold each stored sample. 16 or 24. Only WAV and FLAC have one —
MP3 and Opus store frequencies rather than samples.
_Avoid_: resolution, quality, word length

**Sample rate**:
How many samples a second a file holds. A slice keeps the source file's rate
unless the user picks another. Some output formats accept only certain rates,
and the nearest one they accept is used.
_Avoid_: frequency, resolution, kHz

**Join**:
Combining regions from any track into one output file, with crossfades between
them.
_Avoid_: arrange, concatenate, merge, sequence
