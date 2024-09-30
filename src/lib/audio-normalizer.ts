import {
  getRms,
  normalize,
  compress,
  hardLimit,
  gain,
} from "./audio-processors";

export class AudioNormalizer {
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer | null = null;

  constructor(context: AudioContext, buffer: AudioBuffer) {
    this.audioContext = context;
    this.audioBuffer = buffer;
  }

  async compressTargetingRms(
    targetRms: number = 0.1995262315
  ): Promise<AudioBuffer> {
    if (!this.audioBuffer) throw new Error("No audio file loaded");

    const normalizedBuffer = await normalize(
      this.audioBuffer,
      this.audioContext
    );
    const currentRms = getRms(this.audioBuffer);

    const ratio = currentRms / targetRms;
    const threshold = 0.3; // Adjust as needed

    const compressedBuffer = await compress(
      normalizedBuffer,
      threshold,
      ratio,
      this.audioContext
    );

    // Apply makeup gain to reach target RMS
    const makeupGain = targetRms / getRms(compressedBuffer);

    return await hardLimit(
      await gain(compressedBuffer, makeupGain, this.audioContext),
      0.95,
      this.audioContext
    );
  }
}
