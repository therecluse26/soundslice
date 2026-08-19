/**
 * When is a list of uploads finished?
 *
 * The obvious test, `uploads.every((upload) => upload.isComplete)`, is wrong for
 * an empty list: `[].every(…)` is `true`. A freshly mounted uploader therefore
 * reported "upload complete, here are zero files", and those zero files cleared
 * every track in the store.
 *
 * The rule lives here, not in the component, so it has a test. Vitest runs in
 * plain Node, so nothing testable may touch the DOM.
 *
 * Decided in `.wayfinder/tickets/016-export-empties-track-list.md`.
 */

/** The one field this rule reads. The uploader's `FileUpload` satisfies it. */
export type UploadProgress = { isComplete: boolean };

/** True only when there is at least one upload, and all of them are done. */
export function areUploadsComplete(uploads: UploadProgress[]): boolean {
  return uploads.length > 0 && uploads.every((upload) => upload.isComplete);
}
