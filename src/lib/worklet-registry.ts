/**
 * Which live contexts have the spectral worklet loaded.
 *
 * Tiny on purpose. `graph.ts` reads it synchronously while it builds a chain,
 * and `graph.ts` is in every bundle. The worklet's source and the code that
 * loads it are in `spectral-worklet.ts`, which only a stack with noise
 * reduction or a stretched region ever downloads. Standing rule 6.
 */

const ready = new WeakSet<BaseAudioContext>();

/** True once `ss-denoise` and `ss-pitch` exist on this context. */
export function hasSpectralWorklet(context: BaseAudioContext): boolean {
  return ready.has(context);
}

export function markSpectralWorklet(context: BaseAudioContext): void {
  ready.add(context);
}

/** What the processors are registered as. */
export const DENOISE_PROCESSOR = "ss-denoise";
export const PITCH_PROCESSOR = "ss-pitch";
