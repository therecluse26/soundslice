// Make this an npm package

export function getRms(buffer: AudioBuffer): number {
  let sum = 0;
  const totalSamples = buffer.length * buffer.numberOfChannels;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      sum += channelData[i] * channelData[i];
    }
  }

  return Math.sqrt(sum / totalSamples);
}

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
  threshold: number,
  ratio: number
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const sourceNode = context.createBufferSource();
  sourceNode.buffer = buffer;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(threshold, context.currentTime);
  compressor.ratio.setValueAtTime(ratio, context.currentTime);
  compressor.knee.setValueAtTime(0, context.currentTime);
  compressor.attack.setValueAtTime(0, context.currentTime);
  compressor.release.setValueAtTime(0, context.currentTime);

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
  offlineCompressor.attack.setValueAtTime(0, offlineContext.currentTime);
  offlineCompressor.release.setValueAtTime(0, offlineContext.currentTime);

  offlineSource.connect(offlineCompressor);
  offlineCompressor.connect(offlineContext.destination);

  offlineSource.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  return renderedBuffer;
}

/**
 * Applies hard limiting to an AudioBuffer using Web Audio API.
 *
 * This function uses a WaveShaperNode with a custom curve to implement hard limiting.
 * It processes the audio offline for efficiency and to handle audio of any length.
 *
 * Hard limiting clamps the audio signal to a specified threshold, preventing it from
 * exceeding this level in either the positive or negative direction.
 *
 * @param buffer - The input AudioBuffer to be limited.
 * @param threshold - The maximum absolute value that the audio samples can have. Default is 0.95.
 * @returns A Promise that resolves to the limited AudioBuffer.
 */
export async function hardLimit(
  buffer: AudioBuffer,
  threshold: number = 0.9
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const sourceNode = context.createBufferSource();
  sourceNode.buffer = buffer;

  const waveShaperNode = context.createWaveShaper();
  waveShaperNode.curve = createHardLimitCurve(threshold);

  sourceNode.connect(waveShaperNode);
  waveShaperNode.connect(context.destination);

  sourceNode.start(0);

  const renderedBuffer = await context.startRendering();
  return renderedBuffer;
}

/**
 * Creates a curve for the WaveShaper node to implement hard limiting.
 *
 * This function generates a Float32Array representing a transfer function
 * that clamps values to the specified threshold.
 *
 * @param threshold - The maximum absolute value for the curve.
 * @returns A Float32Array representing the hard limit curve.
 */
function createHardLimitCurve(threshold: number): Float32Array {
  const curve = new Float32Array(2048);
  const range = 1;

  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.max(Math.min(x, threshold), -threshold);
  }

  return curve;
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
