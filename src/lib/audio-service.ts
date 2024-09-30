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
  private context = new AudioContext();

  public loadFile = async (file: File) => {
    this.buffer = await AudioLoader.loadAudioFile(this.context, file);
  };

  public trim = AudioTrimmer.trimAudio;
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

  public static async downloadAllTrimmedFilesAsZip(
    tracks: MutableRefObject<EditorTrack[]>,
    normalize: boolean,
    exportFileType: OutputFormat
  ): Promise<string> {
    const zip = new JSZip();
    const promises: Promise<void>[] = [];

    for (const track of tracks.current) {
      if (!track.selectedRegion) continue;

      const tCtx = new AudioContext();

      const tBuffer = await AudioLoader.loadAudioFile(tCtx, track.file);

      let trimmedBuffer = AudioTrimmer.trimAudio(
        tBuffer,
        tCtx,
        track.selectedRegion.start,
        track.selectedRegion.end
      );

      if (normalize) {
        trimmedBuffer = new AudioNormalizer(
          tCtx,
          trimmedBuffer
        ).compressTargetingRms();
      }

      const downloadUrl = await AudioTrimmer.createDownloadLink(
        trimmedBuffer,
        `trimmed_${track.file.name}`,
        exportFileType
      );
      const fileName = `trimmed_${track.file.name}`;

      promises.push(
        fetch(downloadUrl)
          .then((response) => response.blob())
          .then((blob) => {
            void zip.file(fileName, blob);
          })
      );

      tCtx.close();
    }

    await Promise.all(promises);

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);
    return zipUrl;
  }
}
