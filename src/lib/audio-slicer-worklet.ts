import { AudioLoader } from "./audio-loader";
import { AudioService, OutputFormat } from "./audio-service";
import { AudioTrimmer } from "./audio-trimmer";
import { applyProcessingPipeline } from "./audio-processors";

type SliceAudioParams = {
  track: {
    file: File;
    selectedRegion?: { start: number; end: number };
  } | null;
  normalize: boolean;
  applyPostProcessing: boolean;
  trimSilence: boolean;
};

class AudioSlicerWorklet extends AudioWorkletProcessor {
  private processedBuffer: number[];
  private isProcessing: boolean;
  private paramsLoaded = false;
  private params: SliceAudioParams = {
    track: null,
    normalize: false,
    applyPostProcessing: false,
    trimSilence: false,
  };

  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);

    this.processedBuffer = [];
    this.isProcessing = false;
  }

  handleMessage(event: MessageEvent) {
    if (event.data.action === "setParameters") {
      this.params = event.data.parameters;
      this.paramsLoaded = true;
    }
  }

  static get parameterDescriptors() {
    return [
      { name: "track", defaultValue: {} },
      { name: "normalize", defaultValue: 0 },
      { name: "applyPostProcessing", defaultValue: 0 },
      { name: "trimSilence", defaultValue: 0 },
    ];
  }

  // process(inputs: any, outputs: any, parameters: any) {
  //   const input = inputs[0];
  //   const output = outputs[0];

  //   console.error("Processing audio", input, output, parameters);

  //   return true;
  // }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    // Wait for parameters to be loaded before processing
    if (!this.paramsLoaded) {
      return true;
    }

    const input = inputs[0];
    const output = outputs[0];
    const normalize = parameters.normalize[0] === 1;
    const applyPostProcessing = parameters.applyPostProcessing[0] === 1;
    const trimSilence = parameters.trimSilence[0] === 1;
    console.error("Processing audio", input, output);

    if (!this.params.track?.selectedRegion) {
      console.error("No selected region in track");
      return false;
    }

    if (normalize) {
      console.error("Applying processing pipeline");
      trimmedBuffer = await applyProcessingPipeline(trimmedBuffer, {
        normalize: normalize,
        compress: applyPostProcessing,
        trimSilence: trimSilence,
      });
      console.error("Processing pipeline applied");
    }

    return this.isProcessing;
  }
}

console.error("About to register processor");
registerProcessor("audio-slicer-worklet", AudioSlicerWorklet);
console.error("Processor registered");
