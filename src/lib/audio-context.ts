/**
 * The one live `AudioContext`.
 *
 * Preview needs a live context, and a decode of a file whose header we cannot
 * read needs the machine's sample rate. Both are the same object, created once.
 *
 * A page may hold only a handful of `AudioContext`s, and each one costs an audio
 * thread. `AudioLoader` already kept exactly one and never closed it; this is
 * that context, given a name and a reason.
 */

let live: AudioContext | null = null;

/**
 * The shared live context, created on first use.
 *
 * A browser starts it `suspended` until a user gesture. That is fine for reading
 * `sampleRate`, and preview resumes it before it plays anything.
 */
export function sharedAudioContext(): AudioContext {
  if (!live) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    live = new Ctor();
  }
  return live;
}

/**
 * The rate the audio hardware runs at.
 *
 * Only used as a fallback, when `sniffSampleRate` cannot read a file's own rate.
 * Baselines finding 3 is what makes this a fallback and not the rule: following
 * the machine's rate means the same file gives different bytes on two machines.
 */
export function machineSampleRate(): number {
  return sharedAudioContext().sampleRate;
}

/** Drops the shared context. For tests and hot reloads, not for the app. */
export function closeSharedAudioContext(): void {
  void live?.close();
  live = null;
}
