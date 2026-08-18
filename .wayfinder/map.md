# Map — Simple view and Advanced view

<!-- wayfinder:map -->

Tracker: local markdown. Tickets live in `.wayfinder/tickets/`.
To find the frontier, list open tickets that are unblocked and unassigned:

```sh
grep -L "^\*\*Status:\*\* closed" .wayfinder/tickets/*.md \
  | xargs grep -l "^\*\*Blocked by:\*\* none" \
  | xargs grep -l "^\*\*Assignee:\*\* _unclaimed_"
```

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
  needs WASM everywhere. Do not offer Ogg `.opus`, AAC or Vorbis. Verified
  separately: the whole Web Audio API is `[Exposed=Window]`, so no node graph
  runs in a worker — ticket 007 has been corrected.
- [005 — Research: LUFS loudness per ITU-R BS.1770](./tickets/005-research-lufs-bs1770.md)
  — implement directly, about 150 lines, no runtime dependency. 44.1 kHz
  K-weighting coefficients re-derived and checked against libebur128. EBU Tech
  3341 vectors verified by running a reference implementation, at both 48 and
  44.1 kHz. Keep peak normalization as its own operation beside loudness.

## Not yet specified

- Advanced panel layout for the Regions, Sound and Export sections
- Decide-then-build chains for each of the fourteen features
- The join strip — region order model, crossfade maths, single-file export path
- Saved projects — OPFS schema, what is stored, when it is evicted
- "Copy settings to all tracks" — which settings copy, which do not
- Live preview graph, and the "Fade edges" switch in Simple view. Baselines
  finding 9: a 20 ms fade is already applied to every slice and cannot be turned
  off (`src/lib/audio-trimmer.ts:28`). The switch exposes behaviour that exists.
- The output sample rate contract. Baselines finding 3: every file decodes at the
  machine's audio rate, not its own, so the same file on two machines can produce
  different output. Standing rule 1 requires byte-identical output for the same
  settings. Touches tickets 002, 008 and 011; not yet sharp enough to sit in one.
- How Advanced view hides below 800 px without breaking layout
- Whether `CONTEXT.md` needs an ADR for the edit stack rewrite

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
