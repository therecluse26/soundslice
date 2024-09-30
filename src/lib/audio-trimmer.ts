import { OutputFormat } from "./audio-service";
import AudioWorker from "./audio-worker?worker";

enum Int16Limits {
  MAX_POSITIVE = 0x7fff, // 32,767
  MIN_NEGATIVE = 0x8000, // -32,768
}

export class AudioTrimmer {
  static trimAudio(
    audioBuffer: AudioBuffer,
    audioContext: AudioContext,
    startTime: number,
    endTime: number
  ): AudioBuffer {
    if (!audioBuffer) {
      throw new Error("No audio file loaded");
    }

    const duration = endTime - startTime;
    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const fadeDuration = 0.02; // 20ms fade duration
    const fadeSamples = Math.floor(fadeDuration * sampleRate);

    const trimmedBuffer = audioContext.createBuffer(
      numberOfChannels,
      duration * sampleRate,
      sampleRate
    );

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const originalChannelData = audioBuffer.getChannelData(channel);
      const trimmedChannelData = trimmedBuffer.getChannelData(channel);

      for (let i = 0; i < trimmedBuffer.length; i++) {
        const sourceIndex = i + Math.floor(startTime * sampleRate);
        let sample = originalChannelData[sourceIndex];

        // Apply fade-in
        if (i < fadeSamples) {
          const fadeInFactor = i / fadeSamples;
          sample *= fadeInFactor;
        }

        // Apply fade-out
        if (i >= trimmedBuffer.length - fadeSamples) {
          const fadeOutFactor = (trimmedBuffer.length - i) / fadeSamples;
          sample *= fadeOutFactor;
        }

        trimmedChannelData[i] = sample;
      }
    }

    return trimmedBuffer;
  }

  static createDownloadLink(
    buffer: AudioBuffer,
    fileName: string,
    format: OutputFormat = OutputFormat.MP3
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const worker = new AudioWorker();
      worker.onmessage = (event) => {
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

      worker.postMessage({
        action: "createDownloadLink",
        format: format,
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
