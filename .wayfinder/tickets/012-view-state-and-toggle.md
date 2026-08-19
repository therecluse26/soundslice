# 012 — View state, toggle and the lazy-load boundary

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-18 (view toggle)
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

---

## Resolution — 2026-08-18

Built and verified in Chromium on the production build. Simple view and Advanced
view now exist, and a Simple user downloads none of Advanced.

### What was built

| File | What it is |
|---|---|
| `src/lib/view.ts` | the view vocabulary: `View`, the 800 px rule, `effectiveView` as a plain function |
| `src/lib/persisted.ts` | namespaced, versioned `localStorage` helpers that swallow their errors |
| `src/hooks/useEffectiveView.ts` | the view actually in force, subscribing to `view` alone |
| `src/components/custom/ViewToggle.tsx` | the toggle; hidden below 800 px |
| `src/components/custom/advanced/AdvancedPanel.tsx` | the lazy-loaded shell: Regions, Sound, Export |
| `src/components/custom/AdvancedSettingsChip.tsx` | "N Advanced settings active" |
| `src/components/custom/HiddenRegionsChip.tsx` | "N regions hidden — switch to Advanced to export them" |
| `src/lib/advanced-settings.ts` | the counting rule from ticket 003, in code |

`useMediaQuery` was fixed first, as this ticket requires. It now reads the query
on the first render, and listens to the media query instead of window `resize`.

### Verified, not assumed

| Acceptance | Result |
|---|---|
| The waveform does not move when the view changes | **pass** — `top` 407 px in Advanced, Simple, and Advanced again |
| Advanced opens looking almost identical to Simple | **pass** — three sections, zero open |
| A Simple user downloads no Advanced code | **pass** — only `index.js`; `AdvancedPanel` chunk absent |
| Advanced code loads on demand | **pass** — `AdvancedPanel.js`, 2986 bytes transferred, on first switch |
| The view choice persists | **pass** — `soundslice:view` = `{"v":1,"value":"advanced"}`, survives reload |
| Below 800 px the toggle hides and the view is Simple | **pass** at 700 px — and the stored view stayed `advanced` |
| The Simple view bundle is no larger than today | **fail as written** — see below |

### A layout defect found and fixed during verification

The first build moved the waveform 8 px when the view changed. The cause was
mine: a wrapper `<div className="mb-2">` rendered in Simple view even when the
chip inside returned `null`, so an empty element with a margin held space.

Both chips now own their view check **and** their spacing. Nothing takes up room
when there is nothing to say.

### The bundle acceptance cannot be met as written

| Asset | Baseline | Now | Change |
|---|---|---|---|
| `index.js` raw | 499.27 KiB | 502.49 KiB | +3.22 KiB |
| `index.js` gzip | 153.72 KiB | 154.65 KiB | **+0.93 KiB** |
| `index.css` gzip | 5.87 KiB | 6.02 KiB | +0.15 KiB |
| `AdvancedPanel.js` gzip | — | 2.62 KiB | new, not downloaded by Simple |

Adding a control to Simple view necessarily adds bytes to the Simple bundle. The
acceptance as written is unreachable for any version of this ticket.

The **intent** is met, and it was proven: no Advanced component code is in the
Simple bundle. `Accordion` appears 16 times in the Advanced chunk and **zero**
times in the main one.

### The offset available

`AudioEditor` imports the whole Tailwind config and calls `resolveConfig` at
runtime, to read four colour values. That puts the entire default palette in the
Simple path — `cyan`, `rose`, `lime`, `fuchsia` and `emerald` are all in there,
unused. Raised as
[014 — The whole Tailwind config ships in the Simple bundle](./014-tailwind-config-in-simple-bundle.md).
Taking it would repay this ticket's growth several times over.

### One step deliberately not done

Step 3 said to place `ViewToggle` and the existing `ModeToggle` together. **Only
`ViewToggle` was added.**

`ModeToggle` is currently imported nowhere. The theme is forced to dark:
`ThemeProvider` runs `root.classList.add("dark")` unconditionally at
`src/contexts/ThemeContext.tsx:34`, ignoring the stored theme. `ModeToggle` also
writes `localStorage.theme` while the provider reads `shadcn-ui-theme`, so the
two never meet.

Wiring it in would put a button in the header that does nothing. Commit `8b2a4f9`
removed light theme on purpose, so reviving it is a decision, not a side effect
of this ticket.
