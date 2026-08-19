# 017 — A card rebuilds its region instead of restoring it

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** claude
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

When a card mounts, where does its region come from?

Found while resolving
[016 — "Slice All Files" empties the track list](./016-export-empties-track-list.md).
It is the reason option 1 alone could not pass that ticket's acceptance.

This is a sixth defect. It is latent today, not visible.

## The defect

`src/components/custom/AudioEditor.tsx:287` — on the wavesurfer `ready` event,
every card does this, every time:

```ts
const newRegion = regionsPlugin.addRegion({
  start: 1,
  end: 100,
  content: "Clip",
  color: "rgba(254, 242, 242, 0.25)",
  minLength: 5,
});

handleZoom([0])

// Necessary to set region to trim if region is not changed
onUpdatedRegion(newRegion);
```

A card never reads `track.region`. It writes a fixed 1–100 default and then
overwrites the store with it.

So the store's region is authoritative in one direction only. The card writes to
it and never reads from it.

## Why it is latent

A card only mounts twice if something unmounts it. After ticket 016 nothing
does:

- The master export used to unmount every card. It no longer does.
- The view toggle does not unmount cards. `AdvancedPanel` is inside
  `AudioEditor`, below the lazy boundary.
- A page reload loses the tracks anyway. Nothing persists them.

There is still **no way to remove a single track** in the UI. The first feature
that adds one will remount its neighbours and expose this.

## What must be decided

**Is the store the source of a region, or only its record?**

Two shapes, and they are not the same:

1. **Restore on mount.** The card reads `track.region` and adds that region when
   present, falling back to the default only for a track that has none. Smallest
   change. The default 1–100 stays a default.
2. **The store owns regions outright.** The card renders whatever the store
   holds and never invents anything; a new track gets its default written once,
   when it enters the store, not when a card draws it. Larger, and it is the
   shape [002 — Design the edit stack](./002-design-the-edit-stack.md) implies,
   where a region is data the graph reads.

Ticket 008 rewrites the engine and may absorb this. Decide whether to fix it
now or fold it in.

## Watch for

The 1–100 default is not the whole story. On a 30-second file the region reads
back as 1–30, so the default is clamped somewhere downstream. Whatever replaces
it must keep that clamp, or a short file gets a region past its end.

A second latent hole shares this root and is **not** this ticket. The uploader's
local `uploads` list decides which tracks exist:
`setTracks` merges the incoming list, so an uploader that remounts and then
reports one new file replaces every earlier track. Ticket 016 closed the only
unmount path, so it cannot fire. It fires again the moment one reappears.

## Acceptance

A card that unmounts and remounts comes back with the region the user set, not
with 1–100. Proved with a region dragged away from its default, and a forced
remount.

---

## Resolution — 2026-08-19

**Fixed. Option 1 — the card restores the region, and falls back to the default
only when the track has none.**

Option 2 is not free, and the reason is concrete. The store cannot write the
default region when a track enters it, because the default depends on the file's
duration: `end: 100` clamps to 30 on a 30-second file. Only the card knows the
duration, and only after it decodes. So option 2 needs a duration in the store,
and nothing holds one today.

[008 — Build the edit stack and rewrite the engine](./008-build-the-edit-stack.md)
decodes centrally and will have that duration. Option 2 belongs there.

### The patch

`src/components/custom/AudioEditor.tsx`, in the `ready` handler:

```diff
+      const stored = useAudioStore.getState().getTrack(file.name)?.region;
+
       const newRegion = regionsPlugin.addRegion({
-        start: 1,
-        end: 100,
+        start: stored?.start ?? DEFAULT_REGION.start,
+        end: stored?.end ?? DEFAULT_REGION.end,
```

The 1–100 pair is now a named `DEFAULT_REGION` at module level, with the clamp
written down beside it.

The read goes through `getState`, not the card's `track` selector. This runs in
an event handler, so a selector value would put a value in the effect's
dependencies that changes on every drag. `getTrack` exists for exactly this — the
store documents it as "a non-reactive read, for event handlers".

`file.name` joins that effect's dependency array.

### Measured — Chromium, dev server

The same run twice, before the patch and after. Two files, then
`track-5m.wav`'s region dragged off its default to 00:52. The card is then
unmounted and remounted through the store's own `setTracks`.

| After the remount | Before | After |
|---|---|---|
| Readout | 01:39 | **00:52** |
| Store region | `{ start: 1, end: 100 }` | **`{ start: 1, end: 53.418351477449455 }`** |
| `AudioEditor:track-5m.wav` renders | 12 | 12 |
| `event:region-updated` | 1 | 1 |

The store value after the remount is the **same float** it held before it,
digit for digit. The region is restored, not approximated.

The remount cost does not change. The card still decodes again and still writes
the region once. Only the value it writes changes.

**A new track still gets the default.** A third file added afterwards read 00:29,
the clamped 1–100 on a 30-second file.

**Ticket 016 still holds.** A master export with three cards loaded: the overlay
appears, all three cards stay mounted, and afterwards every region is unchanged —
zero `AudioEditor` renders, zero region writes.

### Cost

| Measurement | Before | Now | Delta |
|---|---|---|---|
| Simple bundle, gzip | 136.69 KiB | **136.76 KiB** | +0.07 KiB |

`pnpm test` stays at 10 tests. **No test was added, on purpose.** The rule here is
one expression — a stored region wins over a default — inside a handler that
needs a decoded waveform. Vitest runs in plain Node. A helper extracted only to
be asserted would test `??`, and the real proof is the measurement above.

### Watch for

The second latent hole named above is **still open**, and this ticket does not
close it. The uploader's local `uploads` list still decides which tracks exist,
so an uploader that remounts and then reports one new file would replace every
earlier track. Ticket 016 closed the only unmount path, so it cannot fire today.

There is still no way to remove a single track in the UI. This ticket's proof had
to reach for `setTracks` directly to force a remount.
