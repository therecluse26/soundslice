# 016 — "Slice All Files" empties the track list

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** claude
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Why does exporting everything throw away everything?

Found while resolving
[015 — Track audio is never released](./015-release-track-audio.md), where the
master export was used as a way to unmount every card. It unmounted them and
they never came back.

This is a fifth defect, beyond the four the map has closed. It is not caused by
ticket 013, 014 or 015, and it predates all three.

## The defect

Click **Slice All Files**. The zip downloads. Every track card then disappears,
the master toolbar disappears, and the page returns to the empty drop zone. The
user's regions are gone with them.

Measured in Chromium, two files loaded:

| Action | Cards before | Cards after |
|---|---|---|
| Per-card **Slice Audio** | 2 | **2** |
| Master **Slice All Files** | 2 | **0** |

The per-card export is fine. Only the master export does it.

## The cause

Two pieces that are each reasonable alone.

**1. The loader replaces the whole page.** `Dashboard.tsx:39` renders the
`SineWaveLoader` *instead of* everything else while `processingLoading` is true.
That includes `BrowserMultiFileUpload`, which therefore unmounts.

**2. An empty upload list reports itself as complete.**
`BrowserMultiFileUpload.tsx:27`:

```ts
useEffect(() => {
  if (
    onUploadComplete &&
    !isUploadComplete &&
    uploads.every((upload) => upload.isComplete)   // true for []
  ) {
    setIsUploadComplete(true);
    onUploadComplete(uploads.map(/* … */));        // calls with []
  }
}, [uploads, onUploadComplete, isUploadComplete]);
```

`[].every(…)` is `true`. So a freshly mounted uploader, with no uploads, reports
"upload complete, here are zero files" the moment it mounts.

Put together: the export sets `processingLoading` true, the uploader unmounts,
the export finishes, `processingLoading` goes false, the uploader **remounts with
fresh state**, its effect fires with an empty list, and `setTracks([])` clears
the store.

Ticket 009's merge does not save this. `setTracks` merges the incoming list
against the stored one, and merging an empty list gives an empty list — the
incoming list is what decides which tracks exist.

## What must be decided

Only one thing, and it is small.

**Which of the two pieces is wrong?** Both fixes work, and they are not the same
fix:

1. **The uploader should not report an empty list.** Guard the effect with
   `uploads.length > 0`. Smallest change. It also stops the pointless
   `setTracks([])` that already runs on every first page load.
2. **The loader should not unmount the page.** Overlay it instead of replacing
   the tree, so nothing remounts. Larger change, and it also fixes the fact that
   a user watching a long export cannot see what they are exporting.

Option 1 is the defect fix. Option 2 is a different, better behaviour that
happens to also fix it.

## Watch for

Fixing this changes what
[015 — Track audio is never released](./015-release-track-audio.md) used as its
unmount path. After this ticket, the master export no longer unmounts the cards,
so 015's proof has to be re-run against a different trigger if it is ever
repeated. 015's result does not change — the revoke happens on unmount, whenever
that is.

There is still **no way to remove a single track** in the UI. That is why 015
could not test removal directly. Whether the Advanced view needs one belongs to
its own feature ticket, not here.

## Acceptance

Exporting all files leaves every track card on screen, with its region intact.
The four-row hash table from
[013](./013-post-processing-guard-defect.md) still holds afterwards.

---

## Resolution — 2026-08-19

**Fixed. Both pieces are wrong, and option 1 alone cannot pass the acceptance.**

The ticket offered a choice. Measurement removed it.

Option 1 keeps the cards. It does **not** keep their regions. A card writes a
fresh default region every time it mounts — `regionsPlugin.addRegion({ start: 1,
end: 100 })` at `src/components/custom/AudioEditor.tsx:289`, then
`onUpdatedRegion` writes it to the store. A card never restores the region the
store holds. So under option 1 the cards return with every user region reset to
1–100, and "with its region intact" fails.

Only option 2 keeps the region, because only option 2 stops the remount.

Option 1 is still right, and is still in. An empty list must not report itself
complete, whatever else is true.

A third hole closes with them. The uploader's local `uploads` list decides which
tracks exist, and `setTracks` merges against it. A remounted uploader has an
empty history, so the next file dropped would have replaced every earlier track
instead of joining it. No unmount path is left, so this cannot fire — see
[017 — A card rebuilds its region instead of restoring it](./017-restore-stored-region.md).

### The patch

**1. An empty list is not complete.** New `src/lib/uploads.ts`, one function, so
the rule has a test. Vitest runs in plain Node, so the rule cannot live in the
component.

```ts
export function areUploadsComplete(uploads: UploadProgress[]): boolean {
  return uploads.length > 0 && uploads.every((upload) => upload.isComplete);
}
```

`BrowserMultiFileUpload.tsx:28` calls it instead of `uploads.every(…)`.

**2. The loader covers the page, it does not replace it.** `Dashboard.tsx` always
renders the tree. When `processingLoading` is true it adds a fixed overlay above
it — `fixed inset-0 z-50`, `hsl(var(--background) / 0.85)`, `role="status"`, the
same `SineWaveLoader` inside. The overlay is on top, so it takes the pointer
events the page would get.

The Tailwind opacity modifier is not used. `tailwind.config.ts:27` defines
`background: "hsl(var(--background))"` with no `<alpha-value>`, so `bg-background/85`
would not produce alpha. The colour is written inline instead. Measured in the
browser: `rgba(10, 10, 10, 0.85)`.

### Measured — Chromium, dev server, `clip-30s.wav` and `track-5m.wav`

`track-5m.wav`'s region was dragged from its 01:39 default to **00:52**, so one
region on screen is the user's and not a default.

| Action | Cards before | Cards after | Regions after |
|---|---|---|---|
| Master **Slice All Files**, first run | 2 | **2** | 00:29, **00:52** |
| Master **Slice All Files**, second run | 2 | **2** | 00:29, **00:52** |
| Add a third file after both exports | 2 | **3** | 00:29, **00:52**, 00:29 |

The ticket measured 2 → **0**. It is now 2 → 2.

The third row is the third hole. Before this fix the two earlier tracks would
have gone when the new file arrived.

**Nothing rebuilds.** Render counts across one master export, from
`window.__renders`:

| Counter | A first mount costs | This export costs |
|---|---|---|
| `AudioEditor:clip-30s.wav` | 10 | **0** |
| `AudioEditor:track-5m.wav` | 10 | **0** |
| `event:region-updated` | 2 | **0** |
| `Dashboard` | — | 4 |
| `MasterToolbar` | — | 8 |

Zero region writes is the proof that the regions are untouched, not merely
redrawn the same. `Dashboard` and `MasterToolbar` counts are dev figures with
StrictMode doubling them.

**Mid-export, read from the page 200 ms after the click:** overlay present,
`z-index: 50`, canvas inside it, and **both cards still mounted with their
durations unchanged**. The user now sees what is being exported.

### The four-row hash table, re-run

`clip-30s.wav`, whole file, WAV out, FNV-1a — the same file, region and hash as
[013](./013-post-processing-guard-defect.md).

| Normalize | Post-processing | Bytes | Hash | 013's hash |
|---|---|---|---|---|
| No | No | 5760044 | `f80bd084` | `f80bd084` |
| No | Yes | 5760044 | `b9fe4d8c` | `b9fe4d8c` |
| Yes | No | 5760044 | `d66014f4` | `d66014f4` |
| Yes | Yes | 5760044 | `b696be4e` | `b696be4e` |

**Four distinct hashes, all four byte-identical to 013.** Expected: no file on
the audio path changed. The diff is `Dashboard.tsx`,
`BrowserMultiFileUpload.tsx` and two new files under `src/lib/`.

### Cost

| Measurement | Before | Now | Delta |
|---|---|---|---|
| Simple bundle, gzip | 136.62 KiB | **136.69 KiB** | +0.07 KiB |
| `pnpm test` | 6 tests | **10 tests** | +4 |

The 72 bytes are the new module and the overlay markup. Standing rule 4 says
Simple must not regress; this is 0.05 % and it buys back a full teardown and
rebuild of every waveform on every export.

### Watch for

**A Vite dev-server artifact looks exactly like this defect.** The first master
export after `pnpm dev` starts makes Vite discover `@toots/shine.js`, optimize
it, and **reload the page**. Every card vanishes and the drop zone returns. It is
a reload, not the app: `performance.getEntriesByType('navigation')[0].type` reads
`"reload"`, and the dev server logs `new dependencies optimized`. Export once to
warm it, then test.

The overlay blocks the mouse. It does not block the keyboard: a tab press can
still reach the drop zone behind it. The export button is already disabled while
downloading, so a second export cannot start. Nothing else behind the overlay
does damage.

[015 — Track audio is never released](./015-release-track-audio.md) used the
master export as its unmount path. That path is gone. 015's result stands — the
revoke happens on unmount, whenever that is — but repeating its proof needs a
different trigger, and there is still no way to remove a single track.
