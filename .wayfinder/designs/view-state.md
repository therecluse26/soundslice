# Design — the view state model

Answer to
[003 — Design the view state model](../tickets/003-design-the-view-state-model.md).
Written and grilled 2026-08-18. **Agreed.**

Three points were settled in grilling, and one of them reverses the ticket:

1. **Simple view exports only the region it draws.** The ticket's pre-agreed
   answer was the opposite. See section 4.
2. **Master defaults persist** across a reload. See section 7.
3. **The chip counts one each, in total**, not per item. See section 3.

It unblocks two build tickets:
[012 — View state, toggle and the lazy-load boundary](../tickets/012-view-state-and-toggle.md)
and [009 — Replace the store's ref and rerender hack](../tickets/009-replace-store-rerender-hack.md).

---

## 1. Where view lives

**View lives in the Zustand store. Not a React context. Not the URL.**

Theme uses a context plus `localStorage`, at `src/contexts/ThemeContext.tsx`.
View does **not** copy that. It copies only the persistence idea.

Three reasons.

1. Ticket 009 moves every setting into real store state. View is a setting.
   Putting it anywhere else splits the source of truth.
2. `AudioEditor` must read view to decide what to draw. A context re-renders
   every consumer on every change. That is the exact problem ticket 009 exists to
   fix. A Zustand selector re-renders only the cards that care.
3. The URL is wrong here. The app is one static page with no router. Audio never
   leaves the browser, so a shared link could never carry the work. A view in the
   URL would promise something the tool cannot do.

### The persisted key

**Use `soundslice:view`, not `view`.**

Ticket 012 says persist under `view`. That is unsafe. The app deploys to GitHub
Pages, where every site under one account shares a single origin, and therefore
one `localStorage`. A bare `view` key can collide with an unrelated project.

Namespace every key this app writes:

| Key | Holds |
|---|---|
| `soundslice:view` | `"simple"` or `"advanced"` |
| `soundslice:master-defaults` | the master defaults object, see section 7 |

Theme's existing `shadcn-ui-theme` key is left alone. Renaming it would silently
reset everyone's theme.

### Reading and writing

Reads are guarded. `localStorage` throws in some private-browsing modes, and an
unparsable value must not break the app.

- Unknown or missing value means Simple. New visitors get Simple.
- Every persisted object carries a version, `{ v: 1, ... }`. An unknown version
  is discarded, not migrated. This is a free tool with no accounts; a clean reset
  beats a migration path nobody will test.

---

## 2. Simple to Advanced, setting by setting

**Simple's switches are named presets over Advanced operations.** There is never
a second code path. That is standing rule 1.

Simple does not have "its own" processing. Simple sets the same operations
Advanced sets, and hides the numbers.

### The full map

| Simple control | What it does today | Advanced equivalent | Same sound? |
|---|---|---|---|
| Normalize Levels? **Yes** | peak normalize to full scale, `audio-processors.ts:135` | **Loudness**, target **-14 LUFS** | **No** — see below |
| Normalize Levels? No | nothing | Loudness off | yes |
| Apply Post Processing? **Yes** | compressor, threshold -8 dB, ratio 4:1, knee 0, attack 8 ms, release 50 ms, `audio-processors.ts:52` | **Compressor**, those exact numbers | yes |
| Apply Post Processing? No | nothing, and see the note on the limiter | Compressor off | yes |
| Output Format | WAV or MP3 | **Format**, plus bit depth and sample rate | yes |
| the region handles | one region per track | **Regions**, many per track | yes |
| *no control* | 20 ms fade in and out, always, `audio-trimmer.ts:28` | **Fade edges**, default 20 ms, on | yes |
| *no control* | limiter at -0.95 dB, ratio 20, only when normalize is on, `audio-processors.ts:342` | **Limiter**, always on | **No** — see below |
| *control commented out* | Trim Silence, broken, `MasterToolbar.tsx:127` | removed; returns later as split-on-silence | n/a |

### Two places where Simple's sound changes

These are not this design's decisions. They are already decided elsewhere. This
design only records them, so nobody is surprised later.

1. **"Normalize Levels? Yes" stops meaning peak normalize.** Ticket 010 wires
   loudness under this switch at -14 LUFS, and gives Simple no new control. Peak
   normalization survives as its own Advanced-only operation, because
   `CONTEXT.md` already separates the two terms and the LUFS research says keep
   both.
2. **The limiter becomes truly always on.** Today it runs only when normalize is
   on, because of the guard in ticket 013. Fixing that guard changes every export
   made with normalize off.

### The rule the map must hold

The same settings in either view must give byte-identical output. So the mapping
above is not a UI convenience. It is a contract:

> Switching view never changes the audio. It only changes which numbers are on
> screen.

Any future Simple control must be defined as "these operations at these values",
or it breaks standing rule 1.

---

## 3. Advanced to Simple

**Switching to Simple never deletes anything.** Simple draws what it can express
and reports the rest.

### What counts as one Advanced setting

The chip needs a rule, not a guess. Count these, across the whole project:

| Counts as one | Example |
|---|---|
| an operation Simple has no switch for | EQ, noise reduction, time and pitch, peak normalize |
| an operation Simple has, held at a non-default value | loudness target -23 instead of -14; fade 200 ms instead of 20 ms |
| more than one region, anywhere | four regions on one track counts **once**, not three |
| an export choice Simple cannot offer | FLAC, Opus, 24-bit, a chosen sample rate, joined output |
| any per-track override of a master default | one track louder than the rest counts **once**, not once per track |

Two deliberate choices in that table. Extra regions count once in total, and
overrides count once in total. Otherwise a normal Advanced project reads
"37 Advanced settings active", which tells the user nothing.

The chip reads **"3 Advanced settings active"**. Clicking it lists them by name.

### Clear Advanced settings

An explicit control beside the chip. It returns every value to something Simple
can express:

- non-default values return to the Simple default
- Advanced-only operations are removed
- every track keeps only its first region
- per-track overrides are dropped, so every track follows master again
- export returns to WAV or MP3, separate files

**This is destructive, so it must be undoable.** It pushes exactly one undo
entry. Ticket 002 owns undo; this design only states the requirement.

---

## 4. Many regions while in Simple view

**Simple view exports only the region it draws. What you see is what you get.**

| Question | Answer |
|---|---|
| Which region does Simple draw? | the **first by start time**, not the first created |
| Does export write the other regions? | **no** |
| Are the other regions deleted? | **no** — they are kept, and return when you switch back |
| What does the track card show? | a chip reading **"3 regions hidden — switch to Advanced to export them"** |
| What does dragging in Simple do? | moves **only** the first region; the others never move |
| Can Simple delete the others? | only through Clear Advanced settings |

**First by start time**, because it is stable and the user can see why it was
chosen. First-created is invisible and changes under re-ordering.

This applies to both export paths. The track's own Slice Audio button and the
master toolbar's Slice All Files both write one file per track in Simple view.

### This overturns the ticket

Ticket 003 question 4 records a pre-agreed answer: export writes every region,
and the chip reads "+3 more regions". The ticket asked to confirm it.

**It was not confirmed. It was reversed**, in grilling on 2026-08-18.

The reason: exporting four files while drawing one region is a silent surprise.
The user finds out only after the files land. Simple view should be literal.

### The trap this creates instead

Switching to Simple quietly changes what your export produces. No work is lost —
standing rule 5 still holds, because every region survives the switch — but the
output is smaller than it was a moment ago.

One guard, and it is required:

The chip is **not** dismissible when a track has more than one region. It names
the consequence in full: which regions are hidden, and what to do about it. A
count alone is not enough, because a count does not say "these will not export".

---

## 5. Master defaults and per-track overrides

**Today there are no per-track settings at all.** `AudioEditor` reads the same
global refs the master toolbar writes, at `AudioEditor.tsx:47`. So this whole
model is new. It is written now so later feature tickets do not each invent one.

### The model

- **Master holds a complete settings object.** Every key has a value.
- **Each track holds a partial.** Only the keys it overrides. Not a copy.
- **Effective settings** are `{ ...master, ...trackPartial }`.

A partial, not a copy, so that changing a master default moves every track that
never disagreed. A copy would freeze each track at the moment it was created.

### How the UI shows it

| State | How it looks | What it offers |
|---|---|---|
| inherited | value shown muted, with the word "inherited" | nothing extra |
| overridden | value shown normally, with a dot beside it | a **Reset** control |

- **Reset** deletes that one key from the track's partial. The track follows
  master again for that setting.
- **Reset all** on a track empties the partial.
- Changing a master default moves every track without that key, immediately. It
  never moves a track that has overridden it.

### What "Copy settings to all tracks" means

The map lists this under **Not yet specified**. This model answers half of it:
copying writes the current effective settings into every track's partial. That
turns inherited values into overrides, which is exactly what the user asked for,
and it is reversible with Reset all. The remaining question — which settings copy
and which do not — stays unspecified, because it depends on the operation set
from ticket 002.

---

## 6. Below 800 px

**The stored view is never rewritten by screen size.**

```
effective view = stored view, unless the screen is under 800 px, in which case Simple
```

So a user who chose Advanced on a desktop, then opens the same browser on a
phone, sees Simple. When they return to a wide screen, Advanced is back. The
stored value was never touched.

The toggle itself is hidden below 800 px, per ticket 012.

**Simple on a phone still shows the chip.** If a desktop session left four
regions on a track, the phone must say so, or the user cannot explain their own
export. "Clear Advanced settings" is available there too.

### A defect ticket 012 will hit

`useMediaQuery` at `src/lib/use-media-query.ts` starts at `false` and only fills
in during an effect. So the first paint always says "not narrow", even on a
phone. The layout flashes wide, then corrects.

It also listens to the window `resize` event rather than the media query itself,
so it can miss a change that arrives without a resize.

It is already used in three places, so fixing it changes existing behaviour.
Ticket 012 should fix it rather than build the toggle on top of it.

---

## 7. What persists

| Thing | Persists? | Why |
|---|---|---|
| view choice | **yes**, `soundslice:view` | cheap, deliberate, and annoying to redo |
| master defaults | **yes**, `soundslice:master-defaults` | small, deliberate, and set on purpose |
| per-track settings | **no** | they belong to a file the browser cannot re-open |
| regions | **no** | same reason |
| tracks and audio | **never** | audio never leaves the browser, and is not stored in it either |

Per-track settings and regions wait for saved projects, which is a later feature
and owns the OPFS question already listed under **Not yet specified**.

Every persisted object carries `{ v: 1 }`. An unknown version is discarded.

---

## Facts checked in the browser while writing this

Three claims were tested rather than assumed, on the production build.

1. **The default region does not overflow a short track.** It is hard-coded to
   `start: 1, end: 100` at `AudioEditor.tsx:213`. On a 30-second file the
   selection reads `00:29`, so wavesurfer clamps the end to the track. **Not a
   defect.** No ticket raised.
2. **The waveform and the engine decode at different rates.** Wavesurfer is built
   with `sampleRate: 44100` at `AudioEditor.tsx:104`. The engine decodes at the
   machine's rate, measured at 48000 Hz. Region maths is safe, because regions
   are in seconds and decoding preserves duration. But the app holds two
   decodings of the same audio at two rates.
3. **Dropping one track costs two decodes and one wasted offline render.**
   Counted in production, per track:

   | Action | `decodeAudioData` calls | Offline renders |
   |---|---|---|
   | drop one file | 2 — one at 48000, one at 44100 | 1, at 48000 |
   | then export it | 3 total | 2 total |

   The decode at drop time is **dead**. `AudioEditor` calls
   `audioService.loadFile`, which stores the result in a private `buffer` that
   nothing ever reads, because `downloadTrimmedFile` calls the **static**
   `AudioService.sliceAudio`, which decodes again.

   So one full decode and one full offline render are thrown away per track, on
   drop. On a 45-minute track that is about 10 seconds of work for nothing.

Facts 2 and 3 belong to ticket 008, not here. They are recorded so ticket 008
does not have to rediscover them.

---

## What ticket 012 and ticket 009 can now assume

- View is `"simple" | "advanced"` in the Zustand store, persisted under
  `soundslice:view`, defaulting to Simple.
- Effective view is derived, never stored. Below 800 px it is always Simple.
- Simple and Advanced write the same operations. Switching never changes audio.
- A track holds a partial of the master settings, never a copy.
- The chip counts by the rule in section 3, and its count is project-wide.
- Simple draws the first region by start time and exports **only** that one.
- Master defaults persist. Per-track settings and regions do not.
