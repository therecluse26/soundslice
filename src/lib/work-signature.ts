/**
 * A track's work as plain JSON, and as one comparable string.
 *
 * Split out of `saved-project.ts` because the store needs these two and only
 * these two. The store is in every bundle; the parser, the guards and the
 * project file are not, and Simple view should not download them until a card
 * asks whether its file was seen before. Standing rule 6.
 */

import type { TrackWork } from "./track-work";

/**
 * The work as plain JSON.
 *
 * A noise profile's magnitudes are a `Float32Array`, which `JSON.stringify`
 * writes as an object with a key per element — 1025 keys. They are written as
 * base64 of the raw bytes instead: exact, and a quarter of the size.
 */
export function serializeWork(work: TrackWork): unknown {
  return JSON.parse(
    JSON.stringify(work, (key, value) =>
      key === "magnitudes" && value instanceof Float32Array
        ? toBase64(value)
        : value
    )
  );
}

/**
 * The work as one string, for "has anything changed since it was seeded?".
 *
 * The selection is left out. Clicking a region is not work, and it must not
 * make autosave remember a file nobody touched.
 */
export function workSignature(work: TrackWork): string {
  return JSON.stringify(serializeWork({ ...work, selectedRegionId: undefined }));
}

function toBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength
  );
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

