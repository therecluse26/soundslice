import lamejs from "@breezystack/lamejs";
import AudioWorker from "./audio-worker?worker";

enum Int16Limits {
  MAX_POSITIVE = 0x7fff, // 32,767
  MIN_NEGATIVE = 0x8000, // -32,768
}

export enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
}

export class AudioTrimmer {
  public format = OutputFormat.MP3;
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer | null = null;
  private worker: Worker;

  constructor(format: OutputFormat = OutputFormat.MP3) {
    this.audioContext = new AudioContext();
    this.format = format;
    this.worker = new AudioWorker();

    console.log("worker", this.worker);
  }

  async loadAudioFile(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
  }

  trimAudio(startTime: number, endTime: number): AudioBuffer {
    if (!this.audioBuffer) {
      throw new Error("No audio file loaded");
    }

    const duration = endTime - startTime;
    const sampleRate = this.audioBuffer.sampleRate;
    const numberOfChannels = this.audioBuffer.numberOfChannels;

    const trimmedBuffer = this.audioContext.createBuffer(
      numberOfChannels,
      duration * sampleRate,
      sampleRate
    );

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const originalChannelData = this.audioBuffer.getChannelData(channel);
      const trimmedChannelData = trimmedBuffer.getChannelData(channel);

      for (let i = 0; i < trimmedBuffer.length; i++) {
        trimmedChannelData[i] =
          originalChannelData[i + Math.floor(startTime * sampleRate)];
      }
    }

    return trimmedBuffer;
  }

  createDownloadLink(buffer: AudioBuffer, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (event) => {
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.url);
        }
      };

      const channelData = [];
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        channelData.push(buffer.getChannelData(i));
      }

      this.worker.postMessage({
        action: "createDownloadLink",
        format: this.format,
        buffer: {
          numberOfChannels: buffer.numberOfChannels,
          sampleRate: buffer.sampleRate,
          length: buffer.length,
          channelData: channelData,
        },
        fileName: fileName,
      });
    });
  }
}
