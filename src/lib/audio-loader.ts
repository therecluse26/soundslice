export class AudioLoader {
  private static tempContext: AudioContext | null = null;

  static async loadAudioFile(file: File): Promise<AudioBuffer> {
    // Create a temporary AudioContext if it doesn't exist
    if (!this.tempContext) {
      this.tempContext = new AudioContext();
    }

    const arrayBuffer = await file.arrayBuffer();

    // Use the temporary AudioContext to decode the audio data
    const audioBuffer = await this.tempContext.decodeAudioData(arrayBuffer);

    // Create an OfflineAudioContext with the correct length
    const offlineContext = new OfflineAudioContext({
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate,
    });

    // Copy the audio data to the offline context
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    // Render the offline context
    const renderedBuffer = await offlineContext.startRendering();

    return renderedBuffer;
  }

  static closeContext(): void {
    if (this.tempContext) {
      this.tempContext.close();
      this.tempContext = null;
    }
  }
}
