type PostProcessingProps = {
  normalize: boolean;
  compress: boolean;
  trimSilence: boolean;
};

/**
 * Applies a gain (volume adjustment) to an AudioBuffer using Web Audio API.
 *
 * This function uses a GainNode to adjust the volume of the audio signal.
 * It processes the audio offline for efficiency and to handle audio of any length.
 *
 * @param buffer - The input AudioBuffer to which gain will be applied.
 * @param gain - The gain factor to apply. 1 is unity gain, <1 reduces volume, >1 increases volume.
 * @returns A Promise that resolves to the gain-adjusted AudioBuffer.
 */
export async function gain(
  buffer: AudioBuffer,
  gain: number
): Promise<AudioBuffer> {
  const offlineContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = buffer;

  const gainNode = offlineContext.createGain();
  gainNode.gain.setValueAtTime(gain, offlineContext.currentTime);

  sourceNode.connect(gainNode);
  gainNode.connect(offlineContext.destination);

  sourceNode.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  return renderedBuffer;
}
/**
 * Applies dynamic range compression to an AudioBuffer using Web Audio API.
 *
 * This function uses the built-in DynamicsCompressorNode to compress the audio signal.
 * It processes the audio offline for efficiency and to handle audio of any length.
 *
 * @param buffer - The input AudioBuffer to be compressed.
 * @param threshold - The decibel value above which the compression will start to be applied.
 * @param ratio - The amount of change in output for a given change in input above the threshold.
 * @returns A Promise that resolves to the compressed AudioBuffer.
 */
export async function compress(
  buffer: AudioBuffer,
  threshold: number = -8,
  ratio: number = 4
): Promise<AudioBuffer> {
  const offlineContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const offlineSource = offlineContext.createBufferSource();
  offlineSource.buffer = buffer;

  const offlineCompressor = offlineContext.createDynamicsCompressor();
  offlineCompressor.threshold.setValueAtTime(
    threshold,
    offlineContext.currentTime
  );
  offlineCompressor.ratio.setValueAtTime(ratio, offlineContext.currentTime);
  offlineCompressor.knee.setValueAtTime(0, offlineContext.currentTime);
  offlineCompressor.attack.setValueAtTime(0.008, offlineContext.currentTime); // 8 ms attack
  offlineCompressor.release.setValueAtTime(0.05, offlineContext.currentTime); // 50 ms release

  offlineSource.connect(offlineCompressor);
  offlineCompressor.connect(offlineContext.destination);

  offlineSource.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  return renderedBuffer;
}

/**
 * Applies limiting to an AudioBuffer using Web Audio API.
 *
 * Limiting clamps the audio signal to a specified threshold, preventing it from
 * exceeding this level in either the positive or negative direction.
 *
 * @param buffer - The input AudioBuffer to be limited.
 * @param threshold - The maximum absolute value that the audio samples can have. Default is 0.95.
 * @returns A Promise that resolves to the limited AudioBuffer.
 */
export async function limit(
  buffer: AudioBuffer,
  threshold: number = -0.95
): Promise<AudioBuffer> {
  const audioContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = buffer;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(threshold, audioContext.currentTime);
  compressor.knee.setValueAtTime(0, audioContext.currentTime); // Hard knee for more precise limiting
  compressor.ratio.setValueAtTime(20, audioContext.currentTime); // High ratio for limiting
  compressor.attack.setValueAtTime(0.003, audioContext.currentTime); // 3 ms attack
  compressor.release.setValueAtTime(0.05, audioContext.currentTime); // 50 ms release

  sourceNode.connect(compressor);
  compressor.connect(audioContext.destination);

  sourceNode.start(0);

  return audioContext.startRendering().then((renderedBuffer) => {
    return renderedBuffer;
  });
}

/**
 * Normalizes an AudioBuffer using Web Audio API.
 *
 * This function adjusts the gain of the audio signal so that the highest peak
 * reaches a normalized level of 1 (or -1 for negative peaks).
 * It processes the audio offline for efficiency and to handle audio of any length.
 *
 * @param buffer - The input AudioBuffer to be normalized.
 * @returns A Promise that resolves to the normalized AudioBuffer.
 */
export async function normalize(buffer: AudioBuffer): Promise<AudioBuffer> {
  const offlineContext = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = buffer;

  const gainNode = offlineContext.createGain();

  // Calculate the maximum amplitude
  const maxAmplitude = getMaxAmplitude(buffer);

  // Set the gain to normalize the audio
  const normalizeGain = 1 / maxAmplitude;
  gainNode.gain.setValueAtTime(normalizeGain, offlineContext.currentTime);

  sourceNode.connect(gainNode);
  gainNode.connect(offlineContext.destination);

  sourceNode.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  return renderedBuffer;
}

/**
 * Calculates the maximum amplitude across all channels of an AudioBuffer.
 *
 * @param buffer - The AudioBuffer to analyze.
 * @returns The maximum absolute amplitude value found in the buffer.
 */
function getMaxAmplitude(buffer: AudioBuffer): number {
  let maxAmplitude = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < channelData.length; i++) {
      const absValue = Math.abs(channelData[i]);
      if (absValue > maxAmplitude) {
        maxAmplitude = absValue;
      }
    }
  }

  return maxAmplitude;
}

/**
 * Applies a specified effect to an AudioBuffer.
 * This function is a wrapper around the specific effect functions.
 *
 * @param buffer - The input AudioBuffer to which the effect will be applied.
 * @param effectName - The name of the effect to apply.
 * @returns A Promise that resolves to the AudioBuffer with the effect applied.
 * @throws An error if the effect name is not recognized.
 */
async function applyEffect(
  buffer: AudioBuffer,
  effectName: string
): Promise<AudioBuffer> {
  switch (effectName) {
    case "normalize":
      return await normalize(buffer);
    case "compress":
      return await compress(buffer);
    case "limit":
      return await limit(buffer);
    case "trimSilence":
      return buffer;
    default:
      throw new Error(`Unknown effect: ${effectName}`);
  }
}

/**
 * Applies a processing pipeline to an AudioBuffer.
 * This function applies a series of effects to the input buffer in sequence.
 * The effects are applied in the order specified by the pipeline array.
 * Each effect is enabled or disabled based on the corresponding property in the props object.
 * The props object should have the following properties:
 * - normalize: boolean - Whether to normalize the audio levels.
 * - compress: boolean - Whether to apply dynamic range compression.
 * - trimSilence: boolean - Whether to trim silence from the audio.
 * The default props object is { normalize: false, compress: false, trimSilence: false }.
 */
export async function applyProcessingPipeline(
  inputBuffer: AudioBuffer,
  {
    normalize: audioNormalize,
    compress: audioCompress,
    trimSilence: audioTrimSilence,
  }: PostProcessingProps = {
    normalize: false,
    compress: false,
    trimSilence: false,
  }
): Promise<AudioBuffer> {
  // Define the processing pipeline, order matters
  const pipeline = [
    { name: "normalize", enabled: audioNormalize },

    { name: "compress", enabled: audioCompress },

    // Normalize again after compression (does nothing if compress is false)
    { name: "normalize", enabled: audioNormalize },

    { name: "trimSilence", enabled: audioTrimSilence },

    // Always limit to prevent clipping at the end
    { name: "limit", enabled: true },
  ];

  for (const step of pipeline) {
    if (step.enabled) {
      inputBuffer = await applyEffect(inputBuffer, step.name);
    }
  }

  // Always limit the audio to prevent clipping, no reason not to
  return inputBuffer;
}

export default {
  gain,
  compress,
  limit,
  normalize,
  applyEffect,
  applyProcessingPipeline,
};
