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

1. Build the view state, per ticket 003. Persist the choice in `localStorage`
   under `view`. New visitors default to Simple.
2. Build `ViewToggle`. Do **not** name it `ModeToggle`; that name is taken by
   the theme toggle at `src/components/mode-toggle.tsx`.
3. Wire it into `src/components/layouts/Header.tsx`, which today holds only a
   centred `Logo`. Place `ViewToggle` and the existing `ModeToggle` together.
4. Hide the toggle below 800 px. `useMediaQuery` at
   `src/lib/use-media-query.ts` already exists and is used in three places.
   Handle the stored-Advanced-on-a-phone case from ticket 003 question 6.
5. Build the Advanced panel shell inside `AudioEditor`: three collapsible
   sections named Regions, Sound and Export. All closed by default. All empty
   for now.
6. Build the lazy-load boundary. Everything Advanced-only sits behind a dynamic
   import, loaded when the user first switches. Prove it: check the network
   panel and confirm a Simple user downloads none of it.
7. Build the "N Advanced settings active" chip in Simple view, per ticket 003.

## Acceptance

The waveform does not move when the view changes. Standing rule: the thing the
user is looking at must stay where it is.

The Simple view bundle is no larger than it is today. Measure it.

Advanced view opens looking almost identical to Simple view, because every panel
starts closed.
