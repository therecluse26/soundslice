/**
 * The preview half of noise reduction and time and pitch: an `AudioWorklet`
 * built from the **same function** the export runs. Tickets 036 and 037.
 *
 * The worklet module is a string — `spectralKit`'s own source text, called once,
 * with two small processors around it — turned into a Blob URL. So the export
 * worker and the preview worklet run one implementation, and preview hears what
 * the file will hold. `spectral.test.ts` checks the function is self-contained
 * enough for that to work.
 *
 * **Live context only.** `addModule` on an `OfflineAudioContext` leaks the whole
 * context in Chromium, which is why export does this work in the encode worker
 * instead. See `prepare-source.ts`.
 *
 * ## The one way preview differs, said plainly
 *
 * Time and pitch in preview uses the media element's own playback rate for the
 * speed — the browser's resampler, not our windowed sinc — and then this
 * worklet's pitch shifter for whatever pitch change is left. The speed and the
 * pitch are the export's; the resampler's fine detail is the browser's. Both
 * processors also delay the sound by one 2048-sample window, about 43 ms, so a
 * region's fade is heard that much earlier than the audio it shapes.
 */

import { SPECTRAL_FFT_SIZE, spectralKit } from "./spectral";
import {
  DENOISE_PROCESSOR,
  PITCH_PROCESSOR,
  markSpectralWorklet,
  hasSpectralWorklet,
} from "./worklet-registry";

function workletSource(): string {
  return `
const kit = (${spectralKit.toString()})();
const FFT_SIZE = ${SPECTRAL_FFT_SIZE};

class Denoise extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.noise = kit.resampleProfile(o.magnitudes, o.profileRate, sampleRate);
    this.fftSize = o.fftSize;
    this.amount = o.amount;
    this.channels = [];
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let c = 0; c < output.length; c++) {
      if (!input[c]) { output[c].fill(0); continue; }
      if (!this.channels[c]) {
        this.channels[c] = kit.createDenoiser(this.fftSize, this.noise, this.amount);
      }
      this.channels[c].process(input[c], output[c]);
    }
    return true;
  }
}

class Pitch extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.semitones = options.processorOptions.semitones;
    this.channels = [];
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let c = 0; c < output.length; c++) {
      if (!input[c]) { output[c].fill(0); continue; }
      if (!this.channels[c]) {
        this.channels[c] = kit.createPitchShifter(FFT_SIZE, this.semitones);
      }
      this.channels[c].process(input[c], output[c]);
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(DENOISE_PROCESSOR)}, Denoise);
registerProcessor(${JSON.stringify(PITCH_PROCESSOR)}, Pitch);
`;
}

const loading = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Loads the worklet onto a live context, once. Later calls share the first.
 *
 * Fails quietly into "not loaded": preview then plays without the effect, and
 * the export — which never needed the worklet — is unaffected.
 */
export function ensureSpectralWorklet(context: AudioContext): Promise<void> {
  if (hasSpectralWorklet(context)) return Promise.resolve();

  let pending = loading.get(context);
  if (!pending) {
    const url = URL.createObjectURL(
      new Blob([workletSource()], { type: "text/javascript" })
    );

    pending = context.audioWorklet
      .addModule(url)
      .then(() => markSpectralWorklet(context))
      .catch((error) => {
        console.error("The preview worklet did not load; previewing without it.", error);
      })
      .finally(() => URL.revokeObjectURL(url));

    loading.set(context, pending);
  }

  return pending;
}
