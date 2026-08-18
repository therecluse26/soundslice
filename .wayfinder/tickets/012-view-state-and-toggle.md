# 012 — View state, toggle and the lazy-load boundary

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** [003 — Design the view state model](./003-design-the-view-state-model.md)
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can the user switch between Simple view and Advanced view, with no Advanced code
downloaded until they do?

This builds the design from ticket 003. Advanced view will be empty at this
point. That is expected — feature tickets fill it later.

The work:

1. Build the view state, per ticket 003. It lives in the Zustand store, not a
   context. Persist the choice in `localStorage` under **`soundslice:view`**.
   New visitors default to Simple.

   **Corrected 2026-08-18.** This ticket used to say the key is `view`. That is
   unsafe. GitHub Pages gives one origin per account, so every site you deploy
   shares one `localStorage`, and a bare `view` key can collide with an unrelated
   project. Namespace every key this app writes.

   Master defaults also persist, under `soundslice:master-defaults`. Per-track
   settings and regions do not. Every persisted object carries `{ v: 1 }`, and an
   unknown version is discarded rather than migrated.
2. Build `ViewToggle`. Do **not** name it `ModeToggle`; that name is taken by
   the theme toggle at `src/components/mode-toggle.tsx`.
3. Wire it into `src/components/layouts/Header.tsx`, which today holds only a
   centred `Logo`. Place `ViewToggle` and the existing `ModeToggle` together.
4. Hide the toggle below 800 px. Never rewrite the stored view. Compute an
   *effective view* from the stored view and the width, so a desktop choice
   survives a visit on a phone. That is ticket 003 question 6.

   **Fix `useMediaQuery` first.** It is at `src/lib/use-media-query.ts` and is
   already used in three places. It starts at `false` and only fills in during an
   effect, so the first paint always claims the screen is wide — even on a phone.
   It also listens to the window `resize` event rather than the media query
   itself. Building the toggle on top of it spreads the flash to the header.
5. Build the Advanced panel shell inside `AudioEditor`: three collapsible
   sections named Regions, Sound and Export. All closed by default. All empty
   for now.
6. Build the lazy-load boundary. Everything Advanced-only sits behind a dynamic
   import, loaded when the user first switches. Prove it: check the network
   panel and confirm a Simple user downloads none of it.
7. Build the "N Advanced settings active" chip in Simple view, per ticket 003.
   It counts **one each, in total**: extra regions count once however many there
   are, and per-track overrides count once however many tracks.

   The per-track region chip is separate and reads "3 regions hidden — switch to
   Advanced to export them". It cannot be dismissed. **Simple view exports only
   the region it draws** — ticket 003 reversed this ticket's original assumption
   that Simple exports every region.

## Acceptance

The waveform does not move when the view changes. Standing rule: the thing the
user is looking at must stay where it is.

The Simple view bundle is no larger than it is today. Measure it.

Advanced view opens looking almost identical to Simple view, because every panel
starts closed.
