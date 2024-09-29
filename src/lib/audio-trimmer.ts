import lamejs from "@breezystack/lamejs";

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

  constructor(format: OutputFormat = OutputFormat.MP3) {
    this.audioContext = new AudioContext();
    this.format = format;
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

  createDownloadLink(buffer: AudioBuffer, fileName: string): string {
    switch (this.format) {
      case OutputFormat.MP3:
        return URL.createObjectURL(this.bufferToMp3(buffer));
      case OutputFormat.WAV:
        return URL.createObjectURL(this.bufferToWav(buffer));
      default:
        throw new Error("Invalid output format");
    }
  }

  private bufferToWav(buffer: AudioBuffer): Blob {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;

    const wavBuffer = new ArrayBuffer(44 + buffer.length * blockAlign);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    const floatTo16BitPCM = (
      output: DataView,
      offset: number,
      input: Float32Array
    ) => {
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(
          offset,
          s < 0 ? s * Int16Limits.MIN_NEGATIVE : s * Int16Limits.MAX_POSITIVE,
          true
        );
        offset += 2;
      }
    };

    // Write WAVE header
    writeString(0, "RIFF");
    view.setUint32(4, 36 + buffer.length * blockAlign, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, buffer.length * blockAlign, true);

    // Write PCM audio data
    let offset = 44;
    const dataLength = buffer.length * numberOfChannels;
    const channelData = new Array(numberOfChannels);

    for (let i = 0; i < numberOfChannels; i++) {
      channelData[i] = buffer.getChannelData(i);
    }

    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = channelData[channel][i];
        const s = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([wavBuffer], { type: "audio/wav" });
  }

  // Output .mp3 file from buffer
  private bufferToMp3(buffer: AudioBuffer): Blob {
    const mp3Encoder = new lamejs.Mp3Encoder(
      buffer.numberOfChannels,
      buffer.sampleRate,
      256
    );

    const leftData = buffer.getChannelData(0);
    const rightData =
      buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftData;

    const left = new Int16Array(leftData.length);
    const right = new Int16Array(rightData.length);

    for (let i = 0; i < leftData.length; i++) {
      left[i] = Math.max(-1, Math.min(1, leftData[i])) * 0x7fff;
      right[i] = Math.max(-1, Math.min(1, rightData[i])) * 0x7fff;
    }

    const mp3Data = mp3Encoder.encodeBuffer(left, right);
    const finalMp3Data = mp3Encoder.flush();

    return new Blob([new Uint8Array(mp3Data), new Uint8Array(finalMp3Data)], {
      type: "audio/mp3",
    });
  }
}
