# 018 — Export blob URLs are never revoked

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Why does every export leak its own output?

Found while writing the worker boundary design for
[007 — Design the worker boundary](./007-design-the-worker-boundary.md), design at
[`designs/worker-boundary.md`](../designs/worker-boundary.md).

This is a seventh defect. It is live, not latent.

## The defect

Three blob URLs are created in `src/`. One is revoked.

| Created at | What it holds | Revoked |
|---|---|---|
| `src/components/custom/AudioEditor.tsx:145` | the track's own file | yes, on unmount |
| `src/lib/audio-worker.ts:28` | one file's encoded output | **no** |
| `src/lib/audio-service.ts:126` | the zip | **no** |

A blob URL pins its blob until it is revoked. That is the same rule
[015 — Track audio is never released](./015-release-track-audio.md) proved, and
it applies here unchanged.

So every **Slice All Files** leaks the encoded output of every file, plus the
zip. Every **Slice Audio** leaks that one file's output.

Rough size, ten `clip-30s.wav` files exported as WAV: 5.76 MB each, plus a 16 MB
zip, is about **74 MB per export**. Export three times and it is 222 MB. Nothing
releases any of it until the tab closes.

`src/bench/main.ts:169` revokes it. Only the bench harness does.

## Where the URL should be revoked

`sliceAllFilesIntoZip` fetches each output URL into the zip and then forgets it:

```ts
promises.push(
  fetch(downloadUrl)
    .then((response) => response.blob())
    .then((blob) => {
      void zip.file(fileName, blob);
    })
);
```

The URL is dead the moment the blob is in the zip.

The zip URL is handed to a click on an `<a>` and forgotten in
`MasterToolbar.handleExportFiles`. The per-card export in `AudioEditor` does the
same with its own output.

## What must be decided

**Who owns an export blob URL, and when is it safe to revoke?**

A download that has not started yet must not have its URL pulled. That is the
only real hazard.

1. **Revoke on the next task after the click.** A `setTimeout(…, 0)` after
   `link.click()`. Common, and it relies on the browser having taken the URL
   already.
2. **Revoke the intermediate URLs immediately, and the zip on a timer.** The
   per-file outputs are never downloaded at all — they exist only to be fetched
   into the zip — so they can be revoked the moment the fetch resolves. Only the
   zip needs the timer.
3. **Do not make a URL at all for the intermediate outputs.** Return the `Blob`
   from the worker instead of a URL, and let only the zip become a URL. Removes
   the hazard rather than timing around it.

Option 3 changes the worker's protocol, which
[`designs/worker-boundary.md`](../designs/worker-boundary.md) section 2 has just
settled as returning a `url`. Weigh that before choosing it.

## Watch for

This does **not** block [008 — Build the edit stack](./008-build-the-edit-stack.md).
Ticket 008 rewrites both files, so fixing them twice is waste. Ticket 008
inherits the rule, not the patch: revoke every blob URL it creates.

The worker boundary design's 1 GB memory ceiling counts loaded tracks only. It
is meaningless while this leak runs, because the leak is unbounded and the
ceiling is not.

## Acceptance

Exporting ten files three times releases what it allocates. Proved the way
ticket 015 proved it: Chromium RSS read from `/proc`, garbage collected through
CDP before each reading.
