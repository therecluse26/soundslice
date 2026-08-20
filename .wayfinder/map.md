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

- [016 — "Slice All Files" empties the track list](./tickets/016-export-empties-track-list.md)
  — **built.** Both pieces the ticket named were wrong, and its option 1 alone
  could not pass its own acceptance. An empty upload list no longer reports
  itself complete, and the loader now **covers** the page instead of replacing
  it. The second half is what keeps the regions: a card writes a fresh 1–100
  default region on every mount and never restores the stored one, so keeping the
  cards without stopping the remount would still have reset every region — now
  ticket 017. A master export costs **zero** `AudioEditor` renders and **zero**
  region writes, where a remount cost 10 renders per card. Exporting twice then
  adding a third file gives three cards with every region intact; it used to give
  none. The four-row hash table from ticket 013 re-runs byte-identical, as
  expected — no file on the audio path changed. Simple bundle 136.62 → 136.69 KiB
  gzip, and `pnpm test` is 6 → 10 tests. Recorded in the ticket: the first master
  export after `pnpm dev` starts makes Vite optimize `@toots/shine.js` and reload
  the page, which looks exactly like this defect and is not.

- [017 — A card rebuilds its region instead of restoring it](./tickets/017-restore-stored-region.md)
  — **built.** A card now reads `track.region` on mount and uses the 1–100
  default only for a track that has none. The store's region was written by the
  card and never read back, so any remount reset the user's selection. Measured
  across a forced remount: the readout went 01:39 → **00:52** and the store kept
  the same float, `end: 53.418351477449455`, digit for digit. A new track still
  gets the clamped default, and ticket 016 still holds. The larger shape — the
  store owning regions outright — is **ticket 008's**, not this one's: the
  default clamps to the file's duration, and only the card knows the duration,
  and only after it decodes. One hole stays open and cannot fire today: the
  uploader's list still decides which tracks exist, so a remounted uploader would
  replace every earlier track. Simple bundle 136.69 → 136.76 KiB gzip. No test
  added, and the ticket says why.

- [007 — Design the worker boundary](./tickets/007-design-the-worker-boundary.md)
  — the design is [`designs/worker-boundary.md`](./designs/worker-boundary.md).
  **The worker encodes and nothing else**, because Web Audio cannot leave the
  main thread and decode was never a freeze. **PCM is transferred, never shared**
  — `SharedArrayBuffer` needs COOP and COEP headers, and GitHub Pages sets none;
  transfer also halves peak memory, 1.04 GB against 2.08 GB on a 45-minute track.
  **One encode worker for the life of the page**, no pool: the step in front of
  it is serial whatever the worker does. **Cancel abandons the result**, it does
  not stop the render, so a generation number rides with each one. **The ceiling
  is 1 GB of encoded audio, and no decoded buffer is ever cached** — a drop that
  would cross it is refused, and nothing is evicted behind the user's back. The
  export stays serial. One safety rule is load-bearing: transferring a channel's
  buffer detaches the whole `AudioBuffer`, so transfer only the freshly rendered
  export buffer. Ruling out `SharedArrayBuffer` also cost the mid-loop cancel
  flag, so the encoder yields between chunks. Two findings: ten files spawn ten
  workers and `terminate()` appears nowhere, and **two blob URLs per export are
  never revoked** — about 74 MB per ten-file export, now ticket 018. Every "not
  worth it" here rests on one unmeasured number, the encode share of a slice.

- [008 — Build the edit stack and rewrite the engine](./tickets/008-build-the-edit-stack.md)
  — **built. The spine is in.** One `buildGraph`, rendered by an
  `OfflineAudioContext` and previewable by a live one, with the region cut by
  `start(0, offset, duration)` and every effect a node in one graph.
  `audio-trimmer.ts`, `audio-processors.ts` and `audio-worker.ts` are deleted,
  and with them both defects this ticket named. **Every baseline is beaten:**
  5-minute MP3 slice 2329.2 → 1494.2 ms, batch of ten 2350 → 1525.2 ms, decode
  1262.7 → 556.7 ms, bundle 136.62 → **111.95 KiB gzip** (JSZip now arrives on
  the click). **A 45-minute track exports three times in a row**, where the
  baseline sweep killed the tab on the second — that was finding 1. Files decode
  at their own sample rate now, which closes the standing rule 1 break in finding
  3. `pnpm test` is 10 → 89. Four defects were found and fixed on the way, and
  the biggest was ours: **the progress worklet ticket 002 chose leaked 322.8 MB
  per thirty renders**, because `addModule` on an `OfflineAudioContext` keeps
  that context alive and there is no `close()` to call. Progress is `suspend()`
  and `resume()` now, and both designs carry the correction. Simple view's stack
  is deliberately **not** the canonical order: the doubled peak normalization is
  input gain staging, and dropping it would make "Apply Post Processing? Yes" do
  nothing on a quiet file.

- [018 — Export blob URLs are never revoked](./tickets/018-revoke-export-blob-urls.md)
  — **fixed inside ticket 008, by option 3.** The worker returns a `Blob`, so an
  intermediate output never becomes a URL and there is nothing to time. One file,
  [`download.ts`](../src/lib/download.ts), is the only place an export blob URL
  is created, and it revokes every one. Measured: **zero blob URLs created** by
  three ten-file exports, and RSS 792.6 → 784.5 MB across thirty renders and
  those exports. The control run holding six zips deliberately released 303.2 MB
  against 317.5 MB held, which is ticket 015's one-for-one rule again.

- [010 — Build LUFS normalization with tests](./tickets/010-build-lufs-normalization.md)
  — **built. "Normalize Levels?" measures loudness now**, per ITU-R BS.1770-5, at
  −14 LUFS with a −1 dBTP ceiling. Simple view gained no control; Advanced view
  got the target. **Verified against ffmpeg's `ebur128` through the production
  UI: −14.0 LUFS, −1.2 dBFS peak**, where the same export read −16.8 before. The
  acceptance is exact — the same music 30.4 LU apart comes out at −13.99 LUFS
  both times. Every EBU Tech 3341 vector a file-based meter can run passes, at
  48 kHz **and** at 44.1 kHz on coefficients no document publishes, which is what
  ticket 005 was for. The interaction the ticket asked about was not the one
  expected: **`DynamicsCompressorNode` applies a +0.541 dB makeup gain nothing
  asked for**, constant at every level below its threshold, which broke the
  ceiling and made every export since before this map 0.541 dB loud. It is now
  measured at runtime and cancelled — not hard-coded, because the Web Audio
  specification does not mention it and another browser may differ. Peak
  normalization stays, as gain staging into the compressor. `pnpm test` 89 → 125.
  Bundle 111.95 → 113.02 KiB gzip, with the loudness DSP in the worker where it
  runs, not in the Simple bundle.

- [011 — WebCodecs encoder path with fallback](./tickets/011-webcodecs-encoder-path.md)
  — **built. Four formats, three encoders.** Advanced view offers **WAV, MP3,
  FLAC and Opus**, with a bit depth and a sample rate beside them; Simple view
  still offers WAV and MP3 and nothing about it changed. **Only Opus is native
  and only Opus can be missing** — it is offered when
  `AudioEncoder.isConfigSupported` says yes to the exact config, on Chrome and
  Edge 94+, Firefox 130+ desktop and Safari 26+. FLAC is libFLAC in WASM on every
  browser, MP3 is still `shine.js` on every browser, and 24-bit WAV is written by
  hand with **`WAVE_FORMAT_EXTENSIBLE`**, verified byte by byte. **An Opus slice
  is a `.webm` file**, because Ogg needs a header no engine emits. The headline
  nobody predicted: **FLAC 16-bit is 2.5× faster than MP3 320 and the same size,
  and it loses nothing** — differenced against the WAV it is one quantization
  step, exactly. Opus is −20.7% against MP3 on a ten-file zip and −17.4% on a
  45-minute track, at 2.4× smaller. Every format opens in ffprobe, VLC and
  Chromium. Two build changes were forced: **the worker is an ES module** so
  mediabunny can be a dynamic import, and the browser target rose to
  `chrome80, edge80, firefox114, safari15` because Safari 13 has no `BigInt`.
  `RenderOptions.sampleRate` is **deleted** — resampling through an
  `AudioBufferSourceNode` aliases, so the rate is chosen once, at the decode.
  The WAV writer now rounds instead of truncating, which costs 15.8 ms on a
  5-minute track and **changes exported bytes**. Simple bundle 113.02 → **113.34
  KiB gzip**, with 258 KiB of mediabunny arriving only for FLAC and Opus.
  `pnpm test` 125 → 165.

- [019 — Wire preview onto the edit stack](./tickets/019-wire-preview-onto-the-edit-stack.md)
  — **built. The play button plays the region through the stack.** wavesurfer's
  own `<audio>` element feeds the graph through `createMediaElementSource`, so
  **no decoded buffer is held** and the 1 GB ceiling never bites — the deciding
  argument against a second `AudioBufferSourceNode`, which would have cost 1.04 GB
  on a 45-minute track. wavesurfer keeps the playhead, the seeking and the
  region-out handling. `buildGraph` was split so **`linkStack` and
  `scheduleRegionEnvelope` are each one implementation that both paths call** —
  ADR 0001 held to properly rather than nominally. Loudness and peak
  normalization **measure on demand up to ten minutes**, cached on file, region,
  stack and rate, and an export fills the same cache; above ten minutes preview
  says the level is not normalized and offers **Measure anyway**, because the
  wait is 23 seconds on a 45-minute track. The **Preview effects** switch is per
  track, in **both views**, and is deliberately not counted on the chip — it
  changes no exported file. Verified by measurement, not by ear: preview applies
  **+9.34 dB** where the export applies **+9.40 dB**, 0.06 dB apart. Two defects
  found by testing and fixed: a routing failure **blanked the whole card**, and a
  dev-only handle broke the node test environment. One finding raised rather than
  fixed: the card has always redrawn ~60 times a second while playing, and
  preview adds none of it — now ticket 020. Simple bundle 113.34 → **115.40 KiB
  gzip**. `pnpm test` 165 → 186.

- [020 — The track card redraws on every timeupdate](./tickets/020-card-redraws-on-timeupdate.md)
  — **built. A playing card renders zero times**, against 382 in three seconds.
  `@wavesurfer/react` kept `currentTime` in React state and set it on every
  `timeupdate`; the card read none of it. The dependency is **deleted** and
  replaced by `useWavesurferInstance`, which is the half the library does not
  export — same creation logic, same flattened dependency array, none of the
  state. The card's `wavesurfer.unAll()` cleanup is gone too: it removed **every**
  listener on the instance including preview's two, and it never removed the
  regions plugin's, so a second `ready` stacked another pair. Every listener is
  now collected and removed by name. Verified: 2 wavesurfer instances created and
  still 2 after playback, two seeks, a resize and six toggles; preview schedules
  its envelope at position 0 on play and at **5** and **21** for seeks to 6 s and
  22 s of a region starting at 1 s; a resize still gives `region-updated: 1` and
  6 renders; and the stack still applies **+9.34 dB**, ticket 019's figure to the
  last digit. Simple bundle 115.40 → **114.35 KiB gzip**, by deleting a
  dependency rather than adding one. Found and left alone: the
  `region-out → region.play()` handler reads as a loop and is not one, and never
  was.

## Not yet specified

- Advanced panel layout for the **Sound and Export** sections. The Regions
  section is settled: it holds the region **tools**, and the per-track region
  **list** lives on the card (grilling, 2026-08-20, ticket 022).
- Decide-then-build chains for each of the fourteen features
- The join strip — region order model, crossfade maths, single-file export path
- Saved projects — OPFS schema, what is stored, when it is evicted
- "Copy settings to all tracks" — which operations copy, and which do not. Now
  sharp enough to answer, because ticket 002 has named the operation set. It
  belongs inside that feature's own decide-then-build chain, which does not exist
  yet. Ticket 003 settled the mechanism: copying writes the current effective
  settings into every track, turning inherited values into overrides, reversible
  with Reset all.
- Removing one track. There is no control for it today, so "tracks on screen"
  means "every track ever loaded", and ticket 007's 1 GB ceiling counts them all.
  Three tickets have now wanted it — 015 could not test removal, 016 lost the
  export as its unmount path, and 017 had to reach for `setTracks` to force a
  remount. It belongs to a feature chain that does not exist yet.
- **Split at transients** — one region per transient. Grilling on 2026-08-20 kept
  it apart from ticket 026: "snap to transients" is a **magnet on a drag**, and
  this is a **detect-then-cut** tool, the same shape as ticket 025. It is a good
  feature and it was deliberately left out of the Regions stretch. It needs its
  own onset-detection decision, which ticket 026 will have made first.
- A level-setting slot before the compressor in the canonical order. Ticket 008
  found the hole: Simple view's "both switches on" stack normalizes, compresses,
  then normalizes again, and the canonical order cannot express that. Whether the
  fix is a second `gain` position, a free-floating `peakNormalization`, or a
  named "input gain" operation is a design decision, and it only matters once
  Advanced view can reorder a stack a user can see.
- Cancelling a running export. The engine takes it — `renderRegion` accepts
  `isCancelled` and an in-flight 5-minute MP3 encode abandons in 76.5 ms — and
  there is no button. Where it lives, and what it does to a half-built zip,
  belongs with whichever ticket adds the control.
- Replacing `shine.js` with `@mediabunny/mp3-encoder`. Ticket 011 left it alone
  on purpose: MP3 is the compatibility format now rather than the only
  compressed one, and mediabunny is already loaded whenever FLAC or Opus is
  chosen. Whether a SIMD LAME build beats a fixed-point Shine build **in the
  browser** is unmeasured by anybody — shine's own benchmarks are native
  binaries. It needs a measurement before it can be a ticket.
- Per-track export overrides. Bit depth, sample rate and output format are
  master defaults, and a track cannot disagree with them. The mechanism is
  ticket 003's; what a per-track override means for a batch that then produces
  four formats in one zip is not decided.

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
