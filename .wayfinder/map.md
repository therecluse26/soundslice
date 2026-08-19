# Map — Simple view and Advanced view

<!-- wayfinder:map -->

Tracker: local markdown. Tickets live in `.wayfinder/tickets/`.
To find the frontier, list open tickets that are unblocked and unassigned:

```sh
grep -L "^\*\*Status:\*\* closed" .wayfinder/tickets/*.md \
  | xargs grep -l "^\*\*Blocked by:\*\* none" \
  | xargs grep -l "^\*\*Assignee:\*\* _unclaimed_"
```

**When you close a ticket, update every ticket it blocked.** The query matches
the literal word `none`. It cannot follow a link to see that a blocker is closed,
so a stale `Blocked by:` line hides a takeable ticket from the frontier. Ticket
009 was invisible for a session because of this. Write
`none — was [name](link), closed <date>` so the history survives.

## Destination

SoundSlice ships a **Simple view** and an **Advanced view** over one shared audio
engine, with all fourteen ideated features built and working.

Done means: both views run 100% in the browser on evergreen desktop browsers,
Simple view has not regressed in speed or function, and no audio code path is
duplicated between the two views.

## Notes

**This map carries build work.** It is not planning-only. Tickets include the
code, not just the decisions.

**Domain.** Browser-only audio slicing. React 18, Vite, TypeScript, Zustand,
wavesurfer.js, Web Audio API. Static deploy to `gh-pages`. No server, ever.

**Skills every session should consult.** `grilling` and `domain-modeling` by
default. `prototype` for UI tickets. `research` for external API tickets.

### Standing rules

1. **One engine, two surfaces.** Simple and Advanced write to the same store and
   call the same processing pipeline. Never two audio code paths. Same settings
   in either view must give byte-identical output.
2. **Advanced is a deep slicer, not a DAW.** No mixer, no shared playhead, no
   simultaneous playback, no recording, no MIDI, no plugins.
3. **The word is `view`.** `mode` already means theme in
   `src/components/mode-toggle.tsx`. Use `view: "simple" | "advanced"`.
4. **Simple must not regress.** Measured against the baselines in ticket 001.
   Advanced may be heavier, but must stay reasonable and be lazy-loaded.
5. **Switching views never loses work.** Advanced settings survive a switch to
   Simple. Simple shows a chip saying how many are active.
6. **Everything Advanced-only is lazy-loaded.** A Simple user downloads none of it.
7. **Anything over 300 ms shows progress.** Long renders run in a worker.

### Settled constraints

| Topic | Decision |
|---|---|
| Naming | "Advanced", not "Pro". The tool is always free. |
| Scope | All fourteen ideated features are in. |
| Browsers | Evergreen Chrome, Edge, Firefox, Safari. Desktop. |
| Mobile | Advanced view is hidden below 800 px. Simple view stays mobile-friendly. |
| Engine | Full rewrite onto the edit stack. No additive second path. |
| Tests | Vitest. DSP and edit stack only. No UI tests. |
| Defects | The three known defects are fixed inside this map. |
| Dependencies | Allowed freely where a good library exists. |
| Deploy | Manual `workflow_dispatch`. No feature flags. |
| Batch export | Kept in Advanced. Per-track settings override master defaults. |
| Ticket shape | Shared engine decisions first, then decide-then-build per feature. |

### The Advanced view vision

Three stages, one direction: **tracks in → regions cut → files out.**

| Stage | Simple view | Advanced view |
|---|---|---|
| Tracks in | Drop files | Same |
| Regions cut | One region per track | Many regions, split on silence, snap to transients |
| Sound | Two Yes/No switches | EQ, loudness target, compressor, noise reduction, time and pitch |
| Files out | WAV or MP3 | FLAC, Opus, bit depth, sample rate, or one joined file |

Each track keeps its own card and its own waveform. Tracks never play together.
The master toolbar holds defaults; any track may override any of them.

"Arrange" is an **output choice**, not a workspace. The master toolbar offers
`separate files | one joined file`. Choosing joined reveals a strip of region
chips that can be reordered, with draggable crossfades between them.

## Decisions so far

<!-- one line per closed ticket -->

- [001 — Measure performance baselines](./tickets/001-measure-performance-baselines.md)
  — the engine's speed today is recorded in [`baselines.md`](./baselines.md);
  ticket 008 must match or beat every median. Ten findings, four of which move
  other tickets: a 45-minute track kills the tab under repeated work; the
  post-processing switch does nothing unless normalize is on (new ticket 013);
  every file decodes at the machine's sample rate, not its own; and
  `performance.memory` does not count audio, so ticket 007 cannot take its
  memory ceiling from heap figures.
- [004 — Research: WebCodecs AudioEncoder](./tickets/004-research-webcodecs-audioencoder.md)
  — no browser can encode MP3 through WebCodecs and none ever will, so
  `shine.js` stays on every browser forever. Safe to add: 24-bit WAV
  (hand-written, cheapest win), Opus in WebM, and a sample rate choice. FLAC
  needs WASM everywhere. Do not offer Ogg `.opus`, AAC or Vorbis. Firefox does
  ship `AudioEncoder` (130, desktop); Safari was the laggard at 26.0. Verified
  separately: the whole Web Audio API is `[Exposed=Window]`, so no node graph
  runs in a worker — ticket 007 has been corrected.
- [005 — Research: LUFS loudness per ITU-R BS.1770](./tickets/005-research-lufs-bs1770.md)
  — implement directly, about 150 lines, no runtime dependency. 44.1 kHz
  K-weighting coefficients re-derived and checked against libebur128. EBU Tech
  3341 vectors verified by running a reference implementation, at both 48 and
  44.1 kHz. Keep peak normalization as its own operation beside loudness.
- [003 — Design the view state model](./tickets/003-design-the-view-state-model.md)
  — the design is [`designs/view-state.md`](./designs/view-state.md). View lives
  in the Zustand store, persisted under `soundslice:view`; master defaults
  persist too, per-track settings do not. Simple's switches are presets over
  Advanced operations, never a second code path. A track stores a partial of the
  master settings, never a copy. The stored view is never rewritten by screen
  size. **Simple view exports only the region it draws** — this reverses the
  ticket's own pre-agreed answer, and ticket 012 is corrected to match.
- [012 — View state, toggle and the lazy-load boundary](./tickets/012-view-state-and-toggle.md)
  — **built.** Simple view and Advanced view both exist, with a toggle in the
  header and a three-section Advanced panel shell, all closed. Verified in
  Chromium: the waveform never moves on a switch, a Simple user downloads no
  Advanced code, and the Advanced chunk arrives on demand at 2986 bytes. The
  bundle acceptance failed as written — adding a control costs 0.93 KiB gzip —
  but no Advanced code is in the Simple bundle. `ModeToggle` was deliberately
  not wired: the theme is forced to dark, so it would do nothing.

- [009 — Replace the store's ref and rerender hack](./tickets/009-replace-store-rerender-hack.md)
  — **built.** The store holds real state; `rerender` and `triggerRerender` are
  gone, and that closes the third of the three known defects. Adding a file to
  three already loaded fell from 48 renders to 12, and no existing card redraws.
  Each card subscribes to its own track and takes a `File` prop, so `React.memo`
  finally works. The wavesurfer `Region` object is out of the store; a track now
  holds `{ start, end }`. Two more defects fixed on the way: dropping a file used
  to duplicate every earlier track, and used to throw away their regions.
  Dropping a file now costs one decode instead of two, and no offline render, so
  [`baselines.md`](./baselines.md) finding 4 carries newer numbers that ticket 008
  must beat. Master defaults now persist. Simple view's output is byte-identical,
  proved against commit `741dc1f`. Revoking each track's blob URL was tried and
  reverted — it breaks under StrictMode — and is now ticket 015.

## Not yet specified

- Advanced panel layout for the Regions, Sound and Export sections
- Decide-then-build chains for each of the fourteen features
- The join strip — region order model, crossfade maths, single-file export path
- Saved projects — OPFS schema, what is stored, when it is evicted
- "Copy settings to all tracks" — which settings copy, which do not. Half
  answered by ticket 003: copying writes the current effective settings into
  every track's partial, turning inherited values into overrides, reversible with
  Reset all. What remains is *which* settings copy, and that waits on the
  operation set from ticket 002.
- Live preview graph, and the "Fade edges" switch in Simple view. Baselines
  finding 9: a 20 ms fade is already applied to every slice and cannot be turned
  off (`src/lib/audio-trimmer.ts:28`). The switch exposes behaviour that exists.
- The output sample rate contract. Baselines finding 3: every file decodes at the
  machine's audio rate, not its own, so the same file on two machines can produce
  different output. Standing rule 1 requires byte-identical output for the same
  settings. Touches tickets 002, 008 and 011; not yet sharp enough to sit in one.
- Whether `CONTEXT.md` needs an ADR for the edit stack rewrite
- New vocabulary for `CONTEXT.md`. Ticket 003 introduced terms the project now
  uses and has not defined: *effective view*, *override* versus *inherited*, and
  the Simple-view *chip*. They should land in the Language section, but the full
  set is not settled until ticket 002 names the operations.

## Out of scope

- **Anything DAW-shaped** — mixer, shared playhead, simultaneous playback,
  recording, input monitoring, MIDI, instruments, plugins. These would make
  SoundSlice compete with Reaper, which it would lose.
- **Server processing, uploads, accounts, paid tiers.** The tool is browser-only
  and always free.
- **Mobile layout for Advanced view.** Fine-grained audio editing on a 390 px
  screen is not a real workflow.
- **Non-evergreen browser support.** No polyfills for browsers two or more
  versions behind.
