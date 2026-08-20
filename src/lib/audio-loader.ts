/**
 * Decoding a file into an `AudioBuffer`, once, at the file's own sample rate.
 *
 * Two things this file used to do, and no longer does:
 *
 * 1. **It decoded, then rendered the result through a full
 *    `OfflineAudioContext` that changed nothing.** Baselines finding 4. On a
 *    45-minute MP3 that copied the whole track for no gain.
 * 2. **It decoded at the machine's sample rate.** Baselines finding 3: all six
 *    test files are 44.1 kHz on disk and all six came back at 48 kHz, so the
 *    same file on two machines gave different exported bytes. That breaks
 *    standing rule 1.
 *
 * The rate now comes from the file's own header, read by `sniffSampleRate`
 * before the decode — `decodeAudioData` detaches the `ArrayBuffer` it is given,
 * so there is no reading it afterwards. A container we cannot read falls back to
 * the machine's rate, which is exactly what every file used to get.
 *
 * **Nothing here caches.** The worker boundary design section 6 forbids it: a
 * decoded 45-minute stereo track is 1.04 GB, and holding one is the difference
 * between a tab that survives and a tab that dies.
 */

import { SNIFF_BYTES, id3TagLength, sniffSampleRate } from "./audio-format";
import { machineSampleRate } from "./audio-context";

export class AudioLoader {
  /**
   * One decoding context per sample rate, reused.
   *
   * A context is what decides the rate `decodeAudioData` resamples to. Its
   * `length` of 1 frame means it allocates nothing worth counting, and keeping
   * it saves constructing one per dropped file.
   */
  private static contexts = new Map<number, OfflineAudioContext>();

  /**
   * Decodes the file, at the rate `chooseRate` asks for.
   *
   * The default keeps the file's own rate, which is the rule. A caller that
   * wants another rate — MP3 at a rate `shine.js` accepts, Opus at one of its
   * five, or a rate the user picked — says so here, **not** by rendering through
   * an `OfflineAudioContext` at the target rate afterwards.
   *
   * That distinction is the whole point. Chrome and Safari resample an
   * `AudioBufferSourceNode` by linear interpolation, which aliases on the way
   * down: a 20 kHz tone resampled 48 → 24 kHz folds back as an audible whistle
   * that was never in the file. `decodeAudioData` on a context already at the
   * target rate uses a real resampler. Ticket 004 named this trap; it costs
   * nothing to avoid because the decode has to happen anyway.
   */
  static async loadAudioFile(
    file: File,
    chooseRate: (fileRate: number) => number = (rate) => rate
  ): Promise<AudioBuffer> {
    const bytes = await file.arrayBuffer();
    const fileRate = this.rateOf(bytes) ?? machineSampleRate();

    return this.contextFor(chooseRate(fileRate)).decodeAudioData(bytes);
  }

  /** The rate this file will decode at, without decoding it. */
  static async sampleRateOf(file: File): Promise<number> {
    return this.rateOf(await file.arrayBuffer()) ?? machineSampleRate();
  }

  /**
   * Reads the rate out of the header, looking past an ID3v2 tag if there is one.
   *
   * **The second look is not an optimisation, it is the whole point.**
   * `clip-30s.mp3` in the benchmark set carries 605216 bytes of ID3 for its
   * album art, so the first frame header sits ten sniff windows in. Without
   * this, that file reported 11025 Hz and decoded at a quarter of its real rate.
   */
  private static rateOf(bytes: ArrayBuffer): number | null {
    const window = (from: number) =>
      new Uint8Array(
        bytes,
        from,
        Math.max(0, Math.min(bytes.byteLength - from, SNIFF_BYTES))
      );

    const head = window(0);
    const rate = sniffSampleRate(head);
    if (rate !== null) return rate;

    const skip = id3TagLength(head);
    if (skip <= 0 || skip >= bytes.byteLength) return null;

    return sniffSampleRate(window(skip));
  }

  private static contextFor(sampleRate: number): OfflineAudioContext {
    const existing = this.contexts.get(sampleRate);
    if (existing) return existing;

    const context = new OfflineAudioContext(1, 1, sampleRate);
    this.contexts.set(sampleRate, context);
    return context;
  }
}
