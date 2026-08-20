/**
 * The one place in the app that turns a `Blob` into a download.
 *
 * It is also the only place that creates an export blob URL, and it revokes
 * every one it creates. That is
 * [018 — Export blob URLs are never revoked](../../.wayfinder/tickets/018-revoke-export-blob-urls.md):
 * a blob URL pins its blob until it is revoked, so a ten-file WAV export used to
 * leak about 74 MB and leak it again on every repeat.
 *
 * The intermediate outputs of a batch export never come here at all. They are
 * `Blob`s from the encode worker that go straight into the zip, so they never
 * become a URL and there is nothing about them to leak.
 */

/**
 * How long the browser gets to take the URL before it is revoked.
 *
 * Revoking in the same task as `click()` is the one real hazard: a download that
 * has not started cannot be started from a dead URL. One task later is the
 * common fix and it relies on the browser having taken the URL already. A whole
 * second is far more than any browser needs and costs nothing to wait.
 */
const REVOKE_AFTER_MS = 1000;

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.style.display = "none";
  link.href = url;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
