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

  public static async sliceAudioViaWorklet(
    track: EditorTrack,
    normalize: boolean,
    applyPostProcessing: boolean,
    trimSilence: boolean,
    exportFileType: OutputFormat
  ): Promise<string | null> {
    return null;
  }

  public static async sliceAudio(
    track: EditorTrack,
    normalize: boolean,
    applyPostProcessing: boolean,
    trimSilence: boolean,
    exportFileType: OutputFormat
  ): Promise<string | null> {
    if (!track?.region) return null;

    const tBuffer = await AudioLoader.loadAudioFile(track.file);

    let trimmedBuffer = AudioTrimmer.trimAudio(
      tBuffer,
      track.region.start,
      track.region.end
    );

    // The pipeline runs on every export, not only when normalize is on.
    //
    // It used to be wrapped in `if (normalize)`. So "Apply Post Processing? Yes"
    // with "Normalize Levels? No" applied nothing at all, and the limiter — the
    // one thing the pipeline marks always-on — never ran either. That is
    // ticket 013, and it was proved with four exports that hashed to three
    // distinct values instead of four.
    //
    // What the limiter is was settled by the edit stack design: one operation in
    // the stack, on by default, last in the canonical order. Simple view keeps
    // it on and last, always. So there is no export this pipeline should skip.
    //
    // `trimSilence` is still threaded through, and is still false everywhere:
    // its control is commented out in `MasterToolbar` and its default is false.
    // The operation is known broken and ticket 008 removes it. This fix must not
    // be the thing that switches it back on.
    trimmedBuffer = await applyProcessingPipeline(trimmedBuffer, {
      normalize: normalize,
      compress: applyPostProcessing,
      trimSilence: trimSilence,
    });

    return await AudioTrimmer.createDownloadLink(
      trimmedBuffer,
      this.getNewFileName(track.file.name, exportFileType),
      exportFileType
    );
  }

  public static async sliceAllFilesIntoZip(
    tracks: EditorTrack[],
    normalize: boolean,
    applyPostProcessing: boolean,
    trimSilence: boolean,
    exportFileType: OutputFormat
  ): Promise<string> {
    const zip = new JSZip();
    const promises: Promise<void>[] = [];

    for (const track of tracks) {
      if (!track.region) continue;

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
