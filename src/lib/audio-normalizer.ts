import { getRms, normalize, compress, hardLimit } from "./audio-processors";

export class AudioNormalizer {
  private audioBuffer: AudioBuffer | null = null;

  constructor(buffer: AudioBuffer) {
    this.audioBuffer = buffer;
  }

  async compressTargetingRms(
    targetRms: number = 0.1995262315
  ): Promise<AudioBuffer> {
    if (!this.audioBuffer) throw new Error("No audio file loaded");

    const currentRms = getRms(this.audioBuffer);

    const ratio = currentRms / targetRms;
    const threshold = 0.3; // Adjust as needed

    // const compressedBuffer = await compress(
    //   await normalize(this.audioBuffer, this.audioContext),
    //   threshold,
    //   ratio,
    //   this.audioContext
    // );

    // Apply makeup gain to reach target RMS
    // const makeupGain = targetRms / getRms(compressedBuffer);

    return await hardLimit(
      await compress(await normalize(this.audioBuffer), threshold, ratio),
      0.9
    );
  }
}
