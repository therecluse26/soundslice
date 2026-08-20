/**
 * The measured gains preview and export share.
 *
 * Loudness and peak normalization cost extra render passes over a decoded
 * buffer. Export pays that on every slice. Preview would pay it on every press
 * of play, which is why this cache exists — and why an export fills it, so the
 * first play after a slice is instant and hears exactly what was sliced.
 *
 * **Numbers only.** No `AudioBuffer` is kept anywhere, which is the worker
 * boundary design's section 6 and the reason a 45-minute track survives. A
 * measurement is two or three doubles; the buffer it came from is 1.04 GB.
 *
 * ## What invalidates an entry
 *
 * Everything the gain depends on is in the key:
 *
 * | Part | Why |
 * |---|---|
 * | file name | a different file is different audio |
 * | region bounds | loudness is measured over the region, not the file |
 * | the stack | an operation before the measuring one changes what it hears |
 * | sample rate | the rate the export renders at, so preview matches it |
 *
 * The region's gain and fades are in the stack key by way of the region, so a
 * dragged fade edge invalidates too. Moving a region by one frame throws its
 * measurement away, which is correct and cheap — the next play measures again.
 */

import { EditStack, Region, regionAudioSignature } from "./edit-stack";

/** What a cached measurement is filed under. */
export type MeasurementKey = string;

/**
 * How many measurements are remembered.
 *
 * One per track is the normal case, and a user with more than 32 tracks on
 * screen has bigger problems than a cache miss. The oldest is dropped first, so
 * the tracks being worked on stay warm.
 */
const MAX_ENTRIES = 32;

const remembered = new Map<MeasurementKey, ReadonlyMap<number, number>>();

export function measurementKey(
  fileName: string,
  region: Region,
  stack: EditStack,
  sampleRate: number
): MeasurementKey {
  // `regionAudioSignature`, not the region itself. Ticket 021 gave a region an
  // id and a name, and neither changes a single sample. Keying on the whole
  // object would throw a measurement away every time a user typed a letter into
  // the name field, and each one costs a full decode to make again.
  return JSON.stringify([
    fileName,
    regionAudioSignature(region),
    stack,
    sampleRate,
  ]);
}

export function recallMeasurement(
  key: MeasurementKey
): ReadonlyMap<number, number> | undefined {
  const found = remembered.get(key);
  if (!found) return undefined;

  // Re-inserting moves it to the end, so the eviction below drops what has been
  // untouched longest rather than what was created longest ago.
  remembered.delete(key);
  remembered.set(key, found);

  return found;
}

export function rememberMeasurement(
  key: MeasurementKey,
  measured: ReadonlyMap<number, number>
): void {
  remembered.delete(key);
  remembered.set(key, measured);

  while (remembered.size > MAX_ENTRIES) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

/** Empties the cache. For tests, and for nothing in the app. */
export function forgetMeasurements(): void {
  remembered.clear();
}
