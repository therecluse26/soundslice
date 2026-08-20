/**
 * Naming the files an export writes.
 *
 * Plain string functions, so Vitest reads them in Node — the same rule
 * `dsp.ts` states.
 *
 * ## The collision this exists to stop
 *
 * `sliced_` plus the stem plus the output format loses files. Load
 * `clip-30s.wav` and `clip-30s.mp3` together, export as WAV, and both want to be
 * `sliced_clip-30s.wav`. JSZip's `file()` overwrites silently, so a zip that
 * should hold three files holds two, with no error anywhere.
 *
 * Found by exporting three tracks and counting what came back. The old
 * `getNewFileName` had the same hole; nothing had looked in the zip before.
 */

/** The name before the last dot. A file with no dot keeps its whole name. */
export function stemOf(fileName: string): string {
  const cut = fileName.lastIndexOf(".");
  return cut > 0 ? fileName.slice(0, cut) : fileName;
}

/** `interview.mp3` exported as WAV becomes `sliced_interview.wav`. */
export function outputFileName(
  fileName: string,
  extension: string,
  prefix = "sliced_"
): string {
  return `${prefix}${stemOf(fileName)}.${extension}`;
}

/**
 * The same name, made unique against the names already used.
 *
 * A clash gets a counter before the extension — `sliced_clip-30s (2).wav` —
 * which is what a file manager does and what a user expects to see.
 *
 * The caller owns `taken` and this function adds to it, so a loop over many
 * files needs no bookkeeping of its own.
 */
export function uniqueFileName(taken: Set<string>, fileName: string): string {
  if (!taken.has(fileName)) {
    taken.add(fileName);
    return fileName;
  }

  const cut = fileName.lastIndexOf(".");
  const stem = cut > 0 ? fileName.slice(0, cut) : fileName;
  const extension = cut > 0 ? fileName.slice(cut) : "";

  for (let counter = 2; ; counter++) {
    const candidate = `${stem} (${counter})${extension}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
