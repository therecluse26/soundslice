import lamejs from "@breezystack/lamejs";

enum Int16Limits {
  MAX_POSITIVE = 0x7fff, // 32,767
  MIN_NEGATIVE = 0x8000, // -32,768
}

enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
}

self.onmessage = (event) => {
  if (event.data.action === "createDownloadLink") {
    const { format, buffer, fileName } = event.data;
    try {
      let blob;
      switch (format) {
        case OutputFormat.MP3:
          blob = bufferToMp3(buffer);
          break;
        case OutputFormat.WAV:
          blob = bufferToWav(buffer);
          break;
        default:
          throw new Error("Invalid output format");
      }
      const url = URL.createObjectURL(blob);
      self.postMessage({ url });
    } catch (error) {
      if (error instanceof Error) {
        self.postMessage({ error: error.message });
      } else {
        self.postMessage({ error: String(error) });
      }
    }
  }
};

function bufferToWav(buffer: any): Blob {
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
  const channelData = buffer.channelData;

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

// function bufferToMp3(buffer: any): Blob {
//   const mp3Encoder = new lamejs.Mp3Encoder(
//     buffer.numberOfChannels,
//     buffer.sampleRate,
//     320
//   );

//   const leftData = buffer.channelData[0];
//   const rightData =
//     buffer.numberOfChannels > 1 ? buffer.channelData[1] : leftData;

//   const left = new Int16Array(leftData.length);
//   const right = new Int16Array(rightData.length);

//   for (let i = 0; i < leftData.length; i++) {
//     left[i] = Math.max(-1, Math.min(1, leftData[i])) * 0x7fff;
//     right[i] = Math.max(-1, Math.min(1, rightData[i])) * 0x7fff;
//   }

//   const mp3Data = mp3Encoder.encodeBuffer(left, right);
//   const finalMp3Data = mp3Encoder.flush();

//   return new Blob([new Uint8Array(mp3Data), new Uint8Array(finalMp3Data)], {
//     type: "audio/mp3",
//   });
// }

function bufferToMp3(buffer: any): Blob {
  const mp3Encoder = new lamejs.Mp3Encoder(
    buffer.numberOfChannels,
    buffer.sampleRate,
    320
  );

  const leftData = buffer.channelData[0];
  const rightData =
    buffer.numberOfChannels > 1 ? buffer.channelData[1] : leftData;
  const length = leftData.length;

  const left = new Int16Array(length);
  const right = new Int16Array(length);

  // Pre-calculate the scaling factor
  const scaleFactor = 0x7fff;

  // Use a single loop for both channels
  for (let i = 0; i < length; i++) {
    left[i] = Math.round(Math.max(-1, Math.min(1, leftData[i])) * scaleFactor);
    right[i] = Math.round(
      Math.max(-1, Math.min(1, rightData[i])) * scaleFactor
    );
  }

  // Encode in chunks to avoid large memory allocations
  const chunkSize = 1152; // MPEG-1 Layer 3 frame size
  const mp3Chunks = [];

  for (let i = 0; i < length; i += chunkSize) {
    const leftChunk = left.subarray(i, i + chunkSize);
    const rightChunk = right.subarray(i, i + chunkSize);
    mp3Chunks.push(mp3Encoder.encodeBuffer(leftChunk, rightChunk));
  }

  mp3Chunks.push(mp3Encoder.flush());

  // Use Uint8Array.from for more efficient array creation
  return new Blob(
    mp3Chunks.map((chunk) => Uint8Array.from(chunk)),
    {
      type: "audio/mp3",
    }
  );
}
