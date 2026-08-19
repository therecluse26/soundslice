# 016 — "Slice All Files" empties the track list

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
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
