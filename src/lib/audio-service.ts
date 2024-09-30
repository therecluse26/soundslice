import { AudioLoader } from "./audio-loader";
import { AudioTrimmer } from "./audio-trimmer";

export enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
}

export class AudioService {
  private buffer: AudioBuffer | null = null;
  private context = new AudioContext();

  public loadFile = async (file: File) => {
    this.buffer = await AudioLoader.loadAudioFile(this.context, file);
  };

  public trim = AudioTrimmer.trimAudio;
  public createDownloadLink = AudioTrimmer.createDownloadLink;

  public getBuffer(): AudioBuffer {
    if (!this.buffer) {
      throw new Error("No audio file loaded");
    }
    return this.buffer;
  }

  public getContext(): AudioContext {
    return this.context;
  }

  public setBuffer(buffer: AudioBuffer): void {
    this.buffer = buffer;
  }

  public setContext(context: AudioContext): void {
    this.context = context;
  }
}
