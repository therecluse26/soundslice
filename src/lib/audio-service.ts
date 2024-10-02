import { MutableRefObject } from "react";
import { AudioLoader } from "./audio-loader";
import { AudioTrimmer } from "./audio-trimmer";
import JSZip from "jszip";
import { EditorTrack } from "@/stores/audio-store";
import { applyProcessingPipeline } from "@/lib/audio-processors";

export enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
}

export class AudioService {
  private buffer: AudioBuffer | null = null;

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
    this.buffer = await AudioLoader.loadAudioFile(file);
  };

  public createDownloadLink = AudioTrimmer.createDownloadLink;

  public static async sliceAudio(
    track: EditorTrack,
    normalize: boolean,
    applyPostProcessing: boolean,
    trimSilence: boolean,
    exportFileType: OutputFormat
  ): Promise<string | null> {
    if (!track.selectedRegion) return null;

    const tBuffer = await AudioLoader.loadAudioFile(track.file);

    let trimmedBuffer = AudioTrimmer.trimAudio(
      tBuffer,
      track.selectedRegion.start,
      track.selectedRegion.end
    );

    if (normalize) {
      // TODO: Make these all configurable
      trimmedBuffer = await applyProcessingPipeline(trimmedBuffer, {
        normalize: normalize,
        compress: applyPostProcessing,
        trimSilence: trimSilence,
      });
    }

    return await AudioTrimmer.createDownloadLink(
      trimmedBuffer,
      this.getNewFileName(track.file.name, exportFileType),
      exportFileType
    );
  }

  public static async sliceAllFilesIntoZip(
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
