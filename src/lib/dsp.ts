/**
 * Plain maths over `Float32Array`. No Web Audio, no DOM, no browser.
 *
 * This module is the shape every later DSP function takes, and it is the reason
 * [006 — Install Vitest](../../.wayfinder/tickets/006-install-vitest.md) needs
 * no Web Audio polyfill and no browser test runner.
 *
 * [The edit stack design](../../.wayfinder/designs/edit-stack.md) settled it:
 * every operation is either a built-in Web Audio node — somebody else's code,
 * not ours to test — or an `AudioWorklet`. A worklet is a thin shell around a
 * plain function over `Float32Array`. So the maths lives here, where a Node test
 * can reach it, and the shell stays untested.
 *
 * Keep this module free of `AudioBuffer`. The moment it imports one, the tests
 * need a browser.
 */

/**
 * The largest absolute sample value across every channel.
 *
 * Returns 0 for silence and for no channels. A caller that divides by this
 * value must guard against 0 itself — see `normalize` in `audio-processors.ts`.
 */
export function maxAmplitude(channels: Float32Array[]): number {
  let peak = 0;

  for (const samples of channels) {
    for (let i = 0; i < samples.length; i++) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }

  return peak;
}
