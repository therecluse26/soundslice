/**
 * Learning a noise profile from a region. Ticket 036.
 *
 * The user selects a region that holds **only** noise — room tone before the
 * first word, the hiss between two takes — and this measures its average
 * spectrum. Noise reduction then subtracts that spectrum from the whole track.
 *
 * Decoded at the file's own rate, so the profile is measured from the audio as
 * recorded. It carries that rate, and is re-read by frequency wherever it is
 * used at another. The decoded buffer is dropped when this returns — ticket
 * 007's rule; only 1025 numbers survive.
 */

import { AudioLoader } from "./audio-loader";
import { learnProfile } from "./spectral-jobs";
import type { NoiseProfile, Region } from "./edit-stack";
import { SPECTRAL_FFT_SIZE } from "./spectral";

/** The shortest region a profile can be learned from, in seconds. */
export const MIN_PROFILE_SEC = 0.25;

let minted = 0;

export async function learnNoiseProfile(
  file: File,
  region: Region
): Promise<NoiseProfile> {
  if (region.end - region.start < MIN_PROFILE_SEC) {
    throw new Error(
      `Select at least ${MIN_PROFILE_SEC * 1000} ms of noise to learn from.`
    );
  }

  const buffer = await AudioLoader.loadAudioFile(file);
  const from = Math.max(0, Math.round(region.start * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.round(region.end * buffer.sampleRate));

  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c).subarray(from, to)
  );

  const magnitudes = await learnProfile(channels, SPECTRAL_FFT_SIZE).done;
  if (!magnitudes) throw new Error("Learning the noise profile was cancelled.");

  minted += 1;
  return {
    id: `ss-noise-${Date.now().toString(36)}-${minted}`,
    magnitudes,
    fftSize: SPECTRAL_FFT_SIZE,
    sampleRate: buffer.sampleRate,
    fromSec: { start: region.start, end: region.end },
  };
}
