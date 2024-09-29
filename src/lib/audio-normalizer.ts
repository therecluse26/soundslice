export class AudioNormalizer {
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer | null = null;

  constructor(context: AudioContext, buffer: AudioBuffer) {
    this.audioContext = context;
    this.audioBuffer = buffer;
  }

  compressTargetingRms(): AudioBuffer {
    const targetRms = -14;
    if (!this.audioBuffer) {
      throw new Error("No audio file loaded");
    }

    // Automatically normalize the audio and then compress it using DynamicsCompressorNode to target the -14 RMS
    // Comment every step of the process
    // Normalize the audio
    const normalizedBuffer = this.normalizeAudio();
    // Get the RMS of the normalized audio
    const rms = this.getRms();
    // Calculate the ratio to compress the audio
    const ratio = targetRms / rms;
    // Create a DynamicsCompressorNode
    const compressor = this.audioContext.createDynamicsCompressor();
    // Set the ratio
    compressor.ratio.value = ratio;
    // Set the threshold to -14 dB
    compressor.threshold.value = -14;
    // Create a GainNode to amplify the audio
    const gain = this.audioContext.createGain();
    // Set the gain to 1 / ratio
    gain.gain.value = 1 / ratio;
    // Connect the nodes
    const source = this.audioContext.createBufferSource();
    source.buffer = normalizedBuffer;
    source.connect(compressor);
    compressor.connect(gain);
    gain.connect(this.audioContext.destination);
    // Start the audio
    source.start();
    // Return the compressed audio
    return normalizedBuffer;
  }

  private getRms(): number {
    if (!this.audioBuffer) {
      throw new Error("No audio file loaded");
    }

    let sum = 0;
    let count = 0;
    for (
      let channel = 0;
      channel < this.audioBuffer.numberOfChannels;
      channel++
    ) {
      const channelData = this.audioBuffer.getChannelData(channel);
      for (let i = 0; i < this.audioBuffer.length; i++) {
        sum += channelData[i] ** 2;
        count++;
      }
    }

    return Math.sqrt(sum / count);
  }

  normalizeAudio(): AudioBuffer {
    if (!this.audioBuffer) {
      throw new Error("No audio file loaded");
    }

    const numberOfChannels = this.audioBuffer.numberOfChannels;
    const sampleRate = this.audioBuffer.sampleRate;

    const maxAmplitude = this.getMaxAmplitude();

    const normalizedBuffer = this.audioContext.createBuffer(
      numberOfChannels,
      this.audioBuffer.length,
      sampleRate
    );

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const originalChannelData = this.audioBuffer.getChannelData(channel);
      const normalizedChannelData = normalizedBuffer.getChannelData(channel);

      for (let i = 0; i < normalizedBuffer.length; i++) {
        normalizedChannelData[i] = originalChannelData[i] / maxAmplitude;
      }
    }

    return normalizedBuffer;
  }

  private getMaxAmplitude(): number {
    if (!this.audioBuffer) {
      throw new Error("No audio file loaded");
    }

    let maxAmplitude = 0;
    for (
      let channel = 0;
      channel < this.audioBuffer.numberOfChannels;
      channel++
    ) {
      const channelData = this.audioBuffer.getChannelData(channel);
      for (let i = 0; i < this.audioBuffer.length; i++) {
        maxAmplitude = Math.max(maxAmplitude, Math.abs(channelData[i]));
      }
    }
    return maxAmplitude;
  }
}
