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
7. **No audio work runs on the main thread. Anything over 300 ms shows progress.**

   Reworded 2026-08-19, by ticket 002. It used to say "long renders run in a
   worker". That blamed the wrong thing. Measured: four `OfflineAudioContext`
   renders took 1741 ms and still drew 103 frames, so Web Audio was never the
   problem. `AudioTrimmer.trimAudio`, a plain sample loop, froze the page for
   454 ms and drew **zero**. The enemy is our own synchronous JavaScript.

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

- [002 — Design the edit stack](./tickets/002-design-the-edit-stack.md)
  — the design is [`designs/edit-stack.md`](./designs/edit-stack.md), with one
  ADR at [`docs/adr/0001-one-graph-two-contexts.md`](../docs/adr/0001-one-graph-two-contexts.md).
  **One Web Audio graph, built once, previewed by a live `AudioContext` and
  exported by an `OfflineAudioContext`** — so preview and export cannot disagree.
  `AudioWorklet` fills what Web Audio lacks, and the maths inside each worklet is
  a plain function, which settles ticket 006's environment question. Seven
  operations on the track, plus gain, fades and time-and-pitch on the region.
  **Trim is not an operation** — the region is the trim, now that Fade edges is a
  real control. Canonical order in Simple; Advanced reorders freely with nothing
  pinned. Undo is a command history, one entry per gesture. Two measurements
  overturned the ticket's premises: Web Audio never froze the page, our own sample
  loop did — so standing rule 7 is reworded above — and an export now follows the
  file's sample rate rather than the machine's, which fixes a standing rule 1
  break. Ticket 013 is unblocked and its answer is already determined.

- [006 — Install Vitest and wire it into the build](./tickets/006-install-vitest.md)
  — **built.** `pnpm test` runs 6 passing tests. **Vitest 0.34.6, plain `node`
  environment, no Web Audio polyfill and no browser** — the last Vitest line that
  runs on Vite 3, so nothing was upgraded. Ticket 002 made that possible: the
  maths inside a worklet is a plain function over `Float32Array`, so
  `src/lib/dsp.ts` holds it and `src/lib/dsp.test.ts` tests it. That module's
  rule is load-bearing for every later DSP test — **the moment it imports an
  `AudioBuffer`, the tests need a browser.** `getMaxAmplitude` is now four lines
  of shell around `maxAmplitude`, with its numbers unchanged. A separate
  `.github/workflows/test.yml` type-checks and tests on every push, because deploy
  is manual and waiting for it means never finding a broken test.

- [014 — The whole Tailwind config ships in the Simple bundle](./tickets/014-tailwind-config-in-simple-bundle.md)
  — **built.** The Simple bundle is **18.4 KiB gzip smaller**, 155.02 down to
  136.62 KiB, so ticket 008's target moves with it. `AudioEditor` reads three
  literals from `src/lib/waveform-colors.ts` instead of resolving the Tailwind
  config at runtime. Every default-palette hex is gone from the bundle; the three
  we use appear once each. The waveform colour is unchanged, proved by reading the
  canvas back pixel by pixel: one colour, `#9ca3af`. That reading also found that
  the `theme === "dark"` branch has **never** run — `ThemeContext` defaults to the
  string `"system"` — so the dark waveform colour is untested, not merely unused.

- [015 — Track audio is never released](./tickets/015-release-track-audio.md)
  — **built.** One effect creates the blob URL and revokes it, so the cleanup
  always revokes the URL *that run* created. That is the whole difference from the
  version ticket 009 reverted. Verified in the dev build with StrictMode on:
  6 URLs created for 3 cards, the 3 discarded ones revoked, the 3 live ones kept,
  every waveform drawn, no `ERR_FILE_NOT_FOUND`. Ten 50.4 MB tracks released
  **505.9 MB** on unmount — **a blob URL holds its file one for one**, which is the
  number ticket 007 was waiting on for its memory ceiling. A fifth defect fell out
  of the testing: exporting all files empties the track list, now ticket 016.

- [013 — Post-processing switch does nothing unless normalize is on](./tickets/013-post-processing-guard-defect.md)
  — **built.** The `if (normalize)` guard is deleted, and the four-row hash table
  now has **four distinct hashes**. The two rows where normalize was on are
  byte-identical to the baseline, so nothing that already worked has moved; only
  the two broken rows changed, and both changed because work the user asked for
  now happens. The cost is one limiter render on the switches-off path — 66.9 ms
  on a 30-second clip, which accounts for its +50.3 ms in full. The processed path
  is at or below its baseline everywhere. This is not an engine regression: that
  path now does work it always claimed to do and silently skipped, and ticket 008
  collapses it into one graph anyway. [`baselines.md`](./baselines.md) carries an
  addendum with every new number.

## Not yet specified

- Advanced panel layout for the Regions, Sound and Export sections
- Decide-then-build chains for each of the fourteen features
- The join strip — region order model, crossfade maths, single-file export path
- Saved projects — OPFS schema, what is stored, when it is evicted
- "Copy settings to all tracks" — which operations copy, and which do not. Now
  sharp enough to answer, because ticket 002 has named the operation set. It
  belongs inside that feature's own decide-then-build chain, which does not exist
  yet. Ticket 003 settled the mechanism: copying writes the current effective
  settings into every track, turning inherited values into overrides, reversible
  with Reset all.
- The region tools — split on silence, and snap to transients. Ticket 002 ruled
  both out of the edit stack: they make and move regions, they do not change
  sound. So each needs its own detection design, and neither is sharp yet.

## Out of scope

- **Anything DAW-shaped** — mixer, shared playhead, simultaneous playback,
  recording, input monitoring, MIDI, instruments, plugins. These would make
  SoundSlice compete with Reaper, which it would lose.
- **Server processing, uploads, accounts, paid tiers.** The tool is browser-only
  and always free.
- **Mobile layout for Advanced view.** Fine-grained audio editing on a 390 px
  screen is not a real workflow.
- **Envelopes** — a setting whose value changes across a track. Named in ticket
  002 as the eventual answer for per-moment control, and deliberately kept out of
  this wave. It is a fifteenth feature, and the destination is the fourteen. It
  matters here only as a promise: because envelopes exist as the future answer,
  regions never have to become the place to put per-moment settings.
- **Non-evergreen browser support.** No polyfills for browsers two or more
  versions behind.
- **Reviving light theme.** The theme is forced to dark in
  `src/contexts/ThemeContext.tsx`, and ticket 014 found that the waveform's
  `theme === "dark"` branch has never run at all — the context reports the string
  `"system"`. So the dark waveform colour is untested code, not merely unused.
  Fixing that is a look-and-feel decision, and the destination is the fourteen
  features. `ModeToggle` stays unwired for the same reason (ticket 012).
