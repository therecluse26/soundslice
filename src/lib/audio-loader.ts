export class AudioLoader {
  static async loadAudioFile(file: File): Promise<AudioBuffer> {
    const context = new AudioContext({
      sampleRate: 44100,
    });
    const arrayBuffer = await file.arrayBuffer();
    context.close();
    return await context.decodeAudioData(arrayBuffer);
  }
}
