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
 * The longest a region's name may be inside a file name.
 *
 * A name is user text and there is no limit on how much of it there is. Most
 * file systems stop at 255 bytes for one path segment, and a path that cannot be
 * written is a file the user silently does not get. Sixty-four characters leaves
 * room for the prefix, the stem, a ` (2)` and the extension on any of them.
 */
export const MAX_REGION_NAME_CHARS = 64;

/**
 * A region's name, made safe to put in a file name.
 *
 * `/` and `\` would make a directory. `:` names a drive on Windows and a
 * resource fork on macOS. `<>"|?*` are refused outright by Windows, and a
 * control character or a null byte can truncate the name where it is used.
 * Every one of them becomes `-`, so the name stays recognisable rather than
 * disappearing.
 *
 * Leading and trailing dots and spaces go too: Windows strips a trailing dot
 * silently, which would turn two different names into one file.
 *
 * Returns `""` for a name carrying no letter and no digit, in any script. The
 * caller falls back to the region's number, so a file is never named after
 * nothing. `///` would otherwise come back as `---`, which reads as a bug rather
 * than as a name.
 */
export function sanitizeNamePart(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, MAX_REGION_NAME_CHARS)
    .replace(/[.\s]+$/, "");

  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

/**
 * What one region of one track is written as.
 *
 * | Case | Name |
 * |---|---|
 * | the track's only region | `sliced_clip-30s.wav` — **no suffix** |
 * | one of many, unnamed | `sliced_clip-30s_1.wav`, numbered by start time |
 * | one of many, named | `sliced_clip-30s_chorus.wav` |
 *
 * **The only region keeps today's name exactly**, so nothing that already works
 * changes. That is standing rule 4, and it is why `onlyRegion` is a parameter
 * rather than something inferred from the number.
 *
 * **The stem always stays.** With twelve files in one zip you must still be able
 * to see which source each came from.
 *
 * The number is the region's position **by start time**, so moving a region past
 * its neighbour renumbers both. That is deliberate: the number matches what the
 * list on the card shows, and a hidden creation order the user cannot see would
 * be worse. A user who wants a stable name gives the region one.
 */
export function regionFileName(
  sourceFileName: string,
  extension: string,
  region: {
    /** The region's own name, if it has one. */
    name?: string;
    /** Its 1-based position by start time. */
    number: number;
    /** True when this track has exactly one region. */
    onlyRegion: boolean;
  },
  prefix = "sliced_"
): string {
  const base = `${prefix}${stemOf(sourceFileName)}`;
  if (region.onlyRegion) return `${base}.${extension}`;

  const suffix = sanitizeNamePart(region.name ?? "") || String(region.number);
  return `${base}_${suffix}.${extension}`;
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
