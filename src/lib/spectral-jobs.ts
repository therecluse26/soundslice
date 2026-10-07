/**
 * The encode worker's spectral jobs: learn a noise profile, denoise, stretch.
 * Tickets 036 and 037.
 *
 * Apart from `encoder.ts` because only noise reduction and time and pitch post
 * them, and both are Advanced-only. `encoder.ts` is in every bundle; this file
 * arrives with the code that needs it. Standing rule 6. The worker, its queue
 * and its cancel are the same ones every export uses.
 */

import { Cancellable, nextJobId, send } from "./encoder";

/**
 * A buffer's channels as fresh copies, ready to transfer.
 *
 * Always a copy: the buffers these come from are decoded sources that the
 * export goes on reading after the job is posted.
 */
function copiedChannels(
  channels: readonly Float32Array[]
): { channels: Float32Array[]; transferList: Transferable[] } {
  const copies = channels.map((channel) => new Float32Array(channel));
  return { channels: copies, transferList: copies.map((copy) => copy.buffer) };
}

/**
 * Learns a noise profile from audio the user marked as noise. Ticket 036.
 *
 * The magnitudes come back; the samples do not.
 */
export function learnProfile(
  channels: readonly Float32Array[],
  fftSize: number
): Cancellable<Float32Array> {
  const copied = copiedChannels(channels);
  return send<Float32Array>(
    { action: "profile", id: nextJobId(), fftSize, channels: copied.channels },
    copied.transferList
  );
}

/** Denoises a segment, off the main thread. Ticket 036. */
export function denoise(
  channels: readonly Float32Array[],
  sampleRate: number,
  amount: number,
  profile: { magnitudes: Float32Array; fftSize: number; sampleRate: number },
  onProgress?: (fraction: number) => void
): Cancellable<Float32Array[]> {
  const copied = copiedChannels(channels);
  return send<Float32Array[]>(
    {
      action: "denoise",
      id: nextJobId(),
      sampleRate,
      amount,
      profile: {
        // A copy, so the stack's own profile is never detached.
        magnitudes: new Float32Array(profile.magnitudes),
        fftSize: profile.fftSize,
        sampleRate: profile.sampleRate,
      },
      channels: copied.channels,
    },
    copied.transferList,
    onProgress
  );
}

/** Changes a segment's speed and pitch, off the main thread. Ticket 037. */
export function stretch(
  channels: readonly Float32Array[],
  rate: number,
  semitones: number,
  onProgress?: (fraction: number) => void
): Cancellable<Float32Array[]> {
  const copied = copiedChannels(channels);
  return send<Float32Array[]>(
    {
      action: "stretch",
      id: nextJobId(),
      rate,
      semitones,
      channels: copied.channels,
    },
    copied.transferList,
    onProgress
  );
}

