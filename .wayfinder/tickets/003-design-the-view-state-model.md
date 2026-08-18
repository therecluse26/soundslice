# 003 — Design the view state model

**Type:** `wayfinder:grilling`
**Status:** open
**Assignee:** _unclaimed_
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
