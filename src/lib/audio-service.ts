import { MutableRefObject } from "react";
import { AudioLoader } from "./audio-loader";
import { AudioTrimmer } from "./audio-trimmer";
import JSZip from "jszip";
import { EditorTrack } from "@/stores/audio-store";
import AudioSlicerWorkletUrl from "./audio-slicer-worklet?worker&url";

export enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
}

export type SliceAudioParams = {
  track: {
    file: File;
    selectedRegion?: { start: number; end: number };
  };
  normalize: boolean;
  applyPostProcessing: boolean;
  trimSilence: boolean;
};

export class AudioService {
  private buffer: AudioBuffer | null = null;
  private audioContext: AudioContext;
  private workletNode: AudioWorkletNode | null = null;

  constructor() {
    this.audioContext = new AudioContext();
  }

  async setupAudioWorklet(params: SliceAudioParams) {
    if (!this.workletNode) {
      await this.audioContext.audioWorklet.addModule(AudioSlicerWorkletUrl);
      this.workletNode = new AudioWorkletNode(
        this.audioContext,
        "audio-slicer-worklet"
      );
      this.workletNode.port.postMessage({
        action: "setParameters",
        parameters: params,
      });
      this.workletNode.connect(this.audioContext.destination);
    }
  }

  private static filenameWithoutExtension = (filename: string) => {
    return filename.split(".").slice(0, -1).join(".");
  };

  public static getNewFileName = (
    fileName: string,
    extension: string,
    prefix: string = "sliced_"
  ) => {
    return `${prefix}${this.filenameWithoutExtension(fileName)}.${extension}`;
  };

  public loadFile = async (file: File) => {
    this.buffer = await AudioLoader.loadAudioFile(file);
  };

  public createDownloadLink = AudioTrimmer.createDownloadLink;

  async sliceAudio(
    track: EditorTrack,
    normalize: boolean,
    applyPostProcessing: boolean,
    trimSilence: boolean,
    exportFileType: OutputFormat
  ): Promise<string | null> {
    await this.setupAudioWorklet({
      track: {
        file: track.file,
        selectedRegion: {
          start: track.selectedRegion?.start || 0,
          end: track.selectedRegion?.end || 0,
        },
      },
      normalize,
      applyPostProcessing,
      trimSilence,
    });

    if (!track?.selectedRegion) {
      console.error("No selected region in track");
      return null;
    }

    console.error("Loading audio file");
    const tBuffer = await AudioLoader.loadAudioFile(track.file);
    console.error("Audio file loaded");

    // Trim audio

    console.error("Trimming audio");
    let trimmedBuffer = AudioTrimmer.trimAudio(
      tBuffer,
      track.selectedRegion.start,
      track.selectedRegion.end
    );
    console.error("Audio trimmed");

    // Create a buffer source from the trimmed buffer
    const source = this.audioContext.createBufferSource();
    source.buffer = trimmedBuffer;

    // Connect the source to the worklet node
    source.connect(this.workletNode!);
    this.workletNode!.connect(this.audioContext.destination);

    // Set parameters for the worklet
    this.workletNode!.parameters.get("start")!.setValueAtTime(
      track.selectedRegion.start,
      this.audioContext.currentTime
    );
    this.workletNode!.parameters.get("end")!.setValueAtTime(
      track.selectedRegion.end,
      this.audioContext.currentTime
    );
    this.workletNode!.parameters.get("fileName")!.setValueAtTime(
      0,
      this.audioContext.currentTime
    );

    this.workletNode!.parameters.get("normalize")!.setValueAtTime(
      normalize ? 1 : 0,
      this.audioContext.currentTime
    );
    this.workletNode!.parameters.get("applyPostProcessing")!.setValueAtTime(
      applyPostProcessing ? 1 : 0,
      this.audioContext.currentTime
    );
    this.workletNode!.parameters.get("trimSilence")!.setValueAtTime(
      trimSilence ? 1 : 0,
      this.audioContext.currentTime
    );

    // Start the source
    source.start();

    // Wait for processing to complete
    return new Promise((resolve) => {
      this.workletNode!.port.onmessage = (event) => {
        if (event.data.action === "processingComplete") {
          resolve(event.data.url);
        } else {
          console.error("Unknown message received:", event.data);
        }
      };
    });
  }

  public async sliceAllFilesIntoZip(
    tracks: MutableRefObject<EditorTrack[]>,
    normalize: boolean,
    applyPostProcessing: boolean,
    trimSilence: boolean,
    exportFileType: OutputFormat
  ): Promise<string> {
    const zip = new JSZip();
    const promises: Promise<void>[] = [];

    for (const track of tracks.current) {
      if (!track.selectedRegion) continue;

      const downloadUrl = await this.sliceAudio(
        track,
        normalize,
        applyPostProcessing,
        trimSilence,
        exportFileType
      );

      if (!downloadUrl) continue;

      const fileName = AudioService.getNewFileName(
        track.file.name,
        exportFileType
      );

      promises.push(
        fetch(downloadUrl)
          .then((response) => response.blob())
          .then((blob) => {
            void zip.file(fileName, blob);
          })
      );
    }

    await Promise.all(promises);

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    return zipUrl;
  }
}
