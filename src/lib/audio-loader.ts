export class AudioLoader {
  static async loadAudioFile(
    context: AudioContext,
    file: File
  ): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    return await context.decodeAudioData(arrayBuffer);
  }
}
