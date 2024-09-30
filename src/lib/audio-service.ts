import { MutableRefObject } from "react";
import { AudioLoader } from "./audio-loader";
import { AudioTrimmer } from "./audio-trimmer";
import JSZip from "jszip";
import { EditorTrack } from "@/stores/audio-store";
import { normalize } from "path";
import { AudioNormalizer } from "./audio-normalizer";

export enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
}

export class AudioService {
  private buffer: AudioBuffer | null = null;
  private context = new AudioContext({
    sampleRate: 44100,
  });

  private static filenameWithoutExtension = (filename: string) => {
    return filename.split(".").slice(0, -1).join(".");
  };

  private static getNewFileName = (
    fileName: string,
    extension: string,
    prefix: string = "sliced_"
  ) => {
    return `${prefix}${this.filenameWithoutExtension(fileName)}.${extension}`;
  };

  public loadFile = async (file: File) => {
    this.buffer = await AudioLoader.loadAudioFile(this.context, file);
  };

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

  public static async sliceAudio(
    track: EditorTrack,
    normalize: boolean,
    exportFileType: OutputFormat
  ): Promise<string | null> {
    if (!track.selectedRegion) return null;

    const tCtx = new AudioContext({
      sampleRate: 44100,
    });

    const tBuffer = await AudioLoader.loadAudioFile(tCtx, track.file);

    let trimmedBuffer = AudioTrimmer.trimAudio(
      tBuffer,
      tCtx,
      track.selectedRegion.start,
      track.selectedRegion.end
    );

    const normalizer = new AudioNormalizer(tCtx, trimmedBuffer);

    if (normalize) {
      trimmedBuffer = await normalizer.compressTargetingRms();
    }
    tCtx.close();

    return await AudioTrimmer.createDownloadLink(
      trimmedBuffer,
      this.getNewFileName(track.file.name, exportFileType),
      exportFileType
    );
  }

  public static async sliceAllFilesIntoZip(
    tracks: MutableRefObject<EditorTrack[]>,
    normalize: boolean,
    exportFileType: OutputFormat
  ): Promise<string> {
    const zip = new JSZip();
    const promises: Promise<void>[] = [];

    for (const track of tracks.current) {
      if (!track.selectedRegion) continue;

      const downloadUrl = await this.sliceAudio(
        track,
        normalize,
        exportFileType
      );

      if (!downloadUrl) continue;

      const fileName = this.getNewFileName(track.file.name, exportFileType);

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
