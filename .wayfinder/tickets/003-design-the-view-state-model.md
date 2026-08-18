# 003 — Design the view state model

**Type:** `wayfinder:grilling`
**Status:** closed
**Assignee:** agent session 2026-08-18 (view state)
**Blocked by:** none
**Blocks:** [009 — Replace the store rerender hack](./009-replace-store-rerender-hack.md), [012 — View state, toggle and lazy-load boundary](./012-view-state-and-toggle.md)
**Map:** [Simple view and Advanced view](../map.md)

## Question

How does view state work, and what exactly happens when the user switches?

Standing rule 5 says switching views never loses work. That rule has edge cases
that must be settled before any UI is built.

Decide:

1. **Where view lives.** Zustand store, React context, or URL. Theme uses
   `localStorage` and a context at `src/hooks/useTheme.tsx`. Does view follow
   the same pattern, or a different one?
2. **Simple → Advanced.** Every Simple setting maps to an Advanced control.
   Confirm that mapping, setting by setting. "Normalize Levels? Yes" becomes
   which loudness target? "Apply Post Processing? Yes" becomes which compressor
   values?
3. **Advanced → Simple.** Simple cannot show an EQ curve or four regions. The
   agreed behaviour is: keep the settings, show a chip reading "3 Advanced
   settings active", offer an explicit "Clear Advanced settings". Settle what
   counts as one setting for that count.
4. **Many regions in Simple.** Simple draws one region. If a track has four,
   which one shows? Does export still write all four? The agreed answer is yes,
   with "+3 more regions" on the chip. Confirm and specify.
5. **Master defaults versus per-track overrides.** How does a track record that
   it has overridden a default? How does the UI show "this is inherited" versus
   "this is set here"? How does "Reset" work?
6. **Below 800 px.** Advanced is hidden. What happens if a user sets Advanced on
   desktop, then opens the same browser on a phone? The stored view says
   advanced; the screen cannot show it.
7. **What persists.** View choice persists. Do track settings persist? Saved
   projects are a later feature, so the answer now is probably no.

## Answer format

A written design, committed to `.wayfinder/designs/view-state.md`, including the
full Simple-to-Advanced setting map as a table, and the switch behaviour in both
directions.

---

## Resolution — 2026-08-18

The design is at [`.wayfinder/designs/view-state.md`](../designs/view-state.md).
It answers all seven questions and holds the full Simple-to-Advanced setting map.

Drafted from the code, then grilled. Three points were settled in that
conversation. One of them reverses this ticket.

### 1. Question 4 is reversed

This ticket recorded a pre-agreed answer: Simple view exports every region, with
"+3 more regions" on the chip. It asked to confirm.

**It was not confirmed. Simple view now exports only the region it draws.**

The other regions are kept, not deleted, and return on switching back to
Advanced. The chip reads "3 regions hidden — switch to Advanced to export them",
and it cannot be dismissed. A bare count does not say "these will not export".

The reason: four files from one visible region is a silent surprise. The user
finds out only after the files land. Simple view should be literal.

### 2. Master defaults persist

`soundslice:master-defaults` in `localStorage`. Per-track settings and regions do
not persist; they wait for saved projects.

### 3. The chip counts one each, in total

Extra regions count once, however many there are. Per-track overrides count once,
however many tracks. Counting per item makes a normal Advanced project read
"37 Advanced settings active", which tells the user nothing.

### The other answers

- **Where view lives:** the Zustand store. Not a context, not the URL. A context
  re-renders every consumer, which is the defect ticket 009 exists to fix.
- **The persisted key is `soundslice:view`, not `view`.** GitHub Pages gives one
  origin per account, so all your Pages sites share one `localStorage`. A bare
  `view` key can collide. Ticket 012 has been corrected.
- **Simple's switches are presets over Advanced operations.** Never a second code
  path. The map records today's real numbers, so the contract is checkable.
- **A track stores a partial of the master settings, never a copy.** So changing
  a master default moves every track that never disagreed.
- **The stored view is never rewritten by screen size.** Effective view is
  derived. Below 800 px it is always Simple, and the desktop choice survives.

### Facts checked in the browser, not assumed

- The hard-coded region `start: 1, end: 100` does **not** overflow a short track.
  Wavesurfer clamps it. On a 30-second file the selection reads `00:29`. Not a
  defect, no ticket raised.
- The waveform decodes at 44100 Hz while the engine decodes at 48000 Hz. Region
  maths is safe, because regions are in seconds. Two decodings are held.
- Dropping one track costs **two decodes and one wasted offline render**, counted
  on the production build. The decode at drop time is dead: `AudioEditor` stores
  it in a private `buffer` that nothing reads, because export calls the static
  `AudioService.sliceAudio`, which decodes again. Recorded for ticket 008.

### A defect ticket 012 must fix first

`useMediaQuery` at `src/lib/use-media-query.ts` starts at `false` and only fills
in during an effect, so the first paint always says "not narrow" — even on a
phone. It also listens to window `resize` rather than the media query. It is
already used in three places. Building the toggle on top of it would spread the
flash.
