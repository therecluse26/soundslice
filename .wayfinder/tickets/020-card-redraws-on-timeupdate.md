# 020 — The track card redraws on every timeupdate

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** build session, 2026-08-19
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

A playing track card re-renders about 60 times a second. Nothing on screen
changes. What is the cheapest way to stop it?

## What was measured

Found while proving [019 — Wire preview onto the edit stack](./019-wire-preview-onto-the-edit-stack.md).
`clip-30s.wav`, three seconds of playback, counted with `countRender`:

| | Renders in 3 s |
|---|---|
| preview enabled | **172** |
| preview disabled | **382** |

**Preview is not the cause and does not add to it.** The two figures differ only
because `timeupdate` fires at whatever rate the page can sustain.

## The cause

`@wavesurfer/react`'s `useWavesurfer`, in its own shipped source:

```js
t.on("timeupdate", (() => { u(t.getCurrentTime()) }))
```

It keeps `isReady`, `isPlaying` and `currentTime` in React state and returns them
beside the wavesurfer instance. `AudioEditor` destructures **only** `wavesurfer`
and reads none of the three — but the state is still set, so React re-renders the
whole card.

`currentTimeRef` already exists in the card and is the value it actually uses.

## Why it matters

This is the redraw storm [009 — Replace the store's ref and rerender hack](./009-replace-store-rerender-hack.md)
was about, in a place that ticket did not look. It costs nothing visible on a
30-second clip and it is 60 wasted renders a second per playing card. Standing
rule 4 says Simple must not regress; this is not a regression, it has always been
here, but it is the same defect class.

## What to weigh

1. **Stop using `useWavesurfer`.** Create the instance directly, as
   `@wavesurfer/react`'s own `useWavesurferInstance` does, and drop the state
   hook. Smallest change, and it removes a dependency's opinion from the card.
2. **Keep `useWavesurfer` and memoise harder.** Split the parts of the card that
   change from the parts that do not, so a redraw costs less. Treats the symptom.
3. **Leave it.** It is invisible today. Say so and close.

Option 1 is the obvious one and the risk is that the card's setup options are
passed through a memoised object; get that wrong and the waveform rebuilds on
every render, which is far worse than the defect.

## Watch for

The card's own `wavesurfer.unAll()` cleanup removes **every** listener on the
instance, including the two that
[`usePreview`](../../src/hooks/usePreview.ts) registers. Any change to how the
instance is made or torn down has to keep preview's `play` and `seeking`
handlers alive, or the region envelope silently stops being scheduled.

## Acceptance

A playing card renders no more than a handful of times a second. The waveform is
not rebuilt by any of it. Preview still schedules its envelope on play and on
seek, proved the way ticket 019 proved it.

---

## Resolution — 2026-08-19

**Built, by option 1. A playing card now renders zero times.**

| | Renders during playback |
|---|---|
| before, 3 seconds | **382** |
| after, 27.5 seconds | **0** |

Not "a handful a second" — **none at all**. Nothing on the card changes while
audio plays, so nothing should redraw, and now nothing does.

### What changed

`@wavesurfer/react` is **gone from the dependencies**. It exports the
`WavesurferPlayer` component and `useWavesurfer`; this app used only the latter,
and only for the instance it creates. The state it keeps beside that instance is
the whole defect.

[`useWavesurferInstance`](../../src/hooks/useWavesurferInstance.ts) is that half
on its own — the library does not export it. It is the same creation logic and
the same flattened dependency array, which is load-bearing: the card builds its
options inline, so a fresh object arrives every render, and comparing the
flattened **values** is what stops the waveform being rebuilt.

The playhead already lived in `currentTimeRef`, which is a ref and costs nothing.

### The second half: `unAll()` was too broad

This ticket's "watch for" was right. The card's cleanup called
`wavesurfer.unAll()`, which removes **every** listener on the instance —
including the two `usePreview` registers for the region envelope. Nothing warned;
preview would simply have stopped applying fades.

Every listener the card adds is now collected and removed one by one. **Two
plugin handlers came with it**: `region-updated` and `region-out` are registered
on the regions plugin, not on wavesurfer, so `unAll()` never removed them at all
and a second `ready` stacked another pair on top.

### Verified

Measured in Chromium, `clip-30s.wav`, region 1–30 s, Normalize Levels at
−14 LUFS.

| Acceptance clause | Result |
|---|---|
| A playing card renders rarely | **0 renders in 27.5 s of playback** |
| The waveform is not rebuilt | **2 instances created, and still 2** after playback, two seeks, a region resize and six switch toggles. Two because React StrictMode mounts every effect twice on purpose. |
| Preview schedules on play | scheduled at position **0**, twice — the `play` handler and the seek `region.play()` performs |
| Preview schedules on seek | seek to 6 s scheduled position **5**; seek to 22 s scheduled **21**. The region starts at 1 s, so both are exact. |
| Region editing still works | a resize gives `region-updated: 1` and **6** card renders — identical to before the change |
| Preview still applies the stack | peak −3.85 dBFS with effects on, −13.19 off, **+9.34 dB** — the same figure ticket 019 measured, to the last digit |

### Bundle

| Asset | After 019 | **After 020** |
|---|---|---|
| `index.*.js` gzip | 115.40 KiB | **114.35 KiB** |

**−1.05 KiB**, by deleting a dependency rather than adding one.

### One thing found and left alone

**Playback stops at the region end; it does not loop.** The card registers
`region-out → region.play()`, which reads as a loop and is not one. The handler
is provably alive — `region-updated` is registered on the same two lines and
demonstrably fires — so this is not a regression from removing `unAll()`. It is
how that handler has always behaved. Whether a preview *should* loop is a
question for whoever owns the transport, not for a render-count ticket.

### Two test hooks, development only

`window.__previewContext` and `window.__previewElements`. Both are behind
`import.meta.env.DEV && typeof window !== "undefined"`, so terser removes them
from the production bundle and Vitest's plain `node` environment does not trip
over them.

The second exists because wavesurfer keeps its `<audio>` element out of the DOM
and the card's play button is not a reliable way to start playback from a test:
`isPlaying` is a ref that desyncs whenever a region ends on its own, so a click
sometimes pauses when you meant to play. Three measurement runs were lost to that
before the element was reachable directly. The registry is capped at 16 entries.
