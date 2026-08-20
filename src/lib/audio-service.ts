/**
 * Slicing — the one path from a loaded track to a file the user can save.
 *
 * Everything this file used to do by hand is now the edit stack:
 *
 * | Before | Now |
 * |---|---|
 * | `AudioTrimmer.trimAudio`, a per-sample loop | `AudioBufferSourceNode.start(0, offset, duration)` |
 * | `applyProcessingPipeline`, one full render per effect | one graph, one render |
 * | a fresh worker per file, never terminated | one worker for the life of the page |
 * | a blob URL per file, never revoked | a `Blob`, and no URL at all |
 * | `AudioLoader.loadAudioFile` called twice per export | once |
 *
 * **Nothing here creates a blob URL.** The caller that needs one for a download
 * makes it and revokes it. That is ticket 018's leak removed rather than timed
 * around: the per-file outputs of a batch export are never downloaded, so they
 * never needed a URL.
 */

import type { EditorTrack } from "@/stores/audio-store";
import { AudioLoader } from "./audio-loader";
import { renderRegion } from "./render";
import { encode } from "./encoder";
import {
  BitDepth,
  DEFAULT_BIT_DEPTH,
  FORMAT_EXTENSION,
  OutputFormat,
  exportSampleRate,
} from "./output-format";
import { outputFileName, uniqueFileName } from "./file-names";
import { EditStack, simpleStack } from "./edit-stack";

export { OutputFormat };

/**
 * What the master toolbar holds, minus anything the engine does not read.
 *
 * `trimSilence` is gone. `audio-processors.ts`'s version read an `AnalyserNode`
 * before the offline render ran, so it read zeros and could not work as written.
 * Its control has been commented out since before this map existed. Region
 * detection is a Regions-feature ticket, not a switch to keep alive here.
 */
export type ExportSettings = {
  normalizeAudio: boolean;
  applyPostProcessing: boolean;
  exportFileType: OutputFormat;

  /**
   * What "Normalize Levels? Yes" aims at, in LUFS.
   *
   * Optional, and it defaults to −14. Simple view has no control for it and the
   * benchmark harness does not set it, so both get the default and neither has
   * to know the number exists.
   */
  loudnessTargetLufs?: number;

  /**
   * Bits per stored sample, for WAV and FLAC. Advanced view only.
   *
   * Optional, and it defaults to 16 — what every export has always written. MP3
   * and Opus ignore it.
   */
  bitDepth?: BitDepth;

  /**
   * The rate to export at, in hertz. Advanced view only.
   *
   * `undefined` means **the file's own rate**, which is the rule and the
   * default. A number here is what the user asked for; the format may still snap
   * it to a rate its encoder accepts.
   */
  outputSampleRate?: number;
};

export type SlicePhase = "render" | "encode" | "zip";

/**
 * Where an export has got to.
 *
 * Standing rule 7 says anything over 300 ms shows progress. A 5-minute MP3
 * export is about four seconds, and a batch of ten is most of a minute, so this
 * is not decoration.
 */
export type SliceProgress = {
  /** 0-based. `fileCount` is 1 for a single-track export. */
  fileIndex: number;
  fileCount: number;
  fileName: string;
  phase: SlicePhase;
  /** 0 to 1 within this phase of this file. */
  phaseProgress: number;
};

export type SliceOptions = {
  onProgress?: (progress: SliceProgress) => void;
  /** Checked between render passes. See `RenderCancelled`. */
  isCancelled?: () => boolean;
};

export class AudioService {
  /**
   * The stack a track exports through.
   *
   * A track with no stack of its own inherits the master defaults, turned into
   * operations by `simpleStack`. That is standing rule 1 in one line: Simple's
   * switches are a preset over Advanced's operations, never a second code path.
   */
  static stackFor(track: EditorTrack, settings: ExportSettings): EditStack {
    return track.stack ?? simpleStack(settings);
  }

  /**
   * True when this export will need a loudness measurement.
   *
   * Not used by the engine — `render.ts` works it out per operation. It exists
   * so a caller can warn before starting: ITU-R BS.1770 over a 45-minute region
   * is seconds of work, on top of an export that is already seconds of work.
   */
  static measuresLoudness(
    track: EditorTrack,
    settings: ExportSettings
  ): boolean {
    return this.stackFor(track, settings).some((op) => op.op === "loudness");
  }

  /**
   * The rate this export decodes, renders and encodes at.
   *
   * The rule lives in [`output-format.ts`](./output-format.ts), where Vitest can
   * read it. This is the shell that reads it out of `ExportSettings`.
   */
  static exportSampleRate(
    sourceRate: number,
    settings: Pick<ExportSettings, "exportFileType" | "outputSampleRate">
  ): number {
    return exportSampleRate(
      sourceRate,
      settings.exportFileType,
      settings.outputSampleRate
    );
  }

  /** `interview.mp3` exported as Opus becomes `sliced_interview.webm`. */
  static outputFileName(
    fileName: string,
    format: OutputFormat,
    prefix = "sliced_"
  ): string {
    return outputFileName(fileName, FORMAT_EXTENSION[format], prefix);
  }

  /**
   * Renders one track's region through its stack and encodes it.
   *
   * Returns `null` when the track has no region, or when the export was
   * cancelled. The returned `Blob` is the caller's to keep or discard.
   */
  static async sliceTrack(
    track: EditorTrack,
    settings: ExportSettings,
    options: SliceOptions & { fileIndex?: number; fileCount?: number } = {}
  ): Promise<Blob | null> {
    if (!track.region) return null;

    const report = (phase: SlicePhase, phaseProgress: number) =>
      options.onProgress?.({
        fileIndex: options.fileIndex ?? 0,
        fileCount: options.fileCount ?? 1,
        fileName: track.file.name,
        phase,
        phaseProgress,
      });

    // One decode, at the one rate this export uses. This buffer is not cached
    // and not shared — the design's section 6 forbids caching, and that is what
    // makes the transfer below safe.
    const source = await AudioLoader.loadAudioFile(track.file, (fileRate) =>
      this.exportSampleRate(fileRate, settings)
    );

    const rendered = await renderRegion(
      source,
      track.region,
      this.stackFor(track, settings),
      {
        onProgress: (fraction) => report("render", fraction),
        isCancelled: options.isCancelled,
      }
    );

    // `rendered` is fresh and nothing else holds it, so its channels are
    // transferred rather than copied. Transferring detaches the whole
    // `AudioBuffer`; nothing reads it after this line.
    return encode(rendered, settings.exportFileType, {
      bitDepth: settings.bitDepth ?? DEFAULT_BIT_DEPTH,
      onProgress: (fraction) => report("encode", fraction),
    }).done;
  }

  /**
   * Slices every track that has a region, into one zip.
   *
   * Serial, one file at a time, exactly as before. Overlapping the encode of
   * file *N* with the render of file *N+1* is possible with one worker and no
   * pool, and the worker boundary design deliberately does not build it: it
   * doubles peak memory to save a share of the work nobody has measured.
   */
  static async sliceAllFilesIntoZip(
    tracks: EditorTrack[],
    settings: ExportSettings,
    options: SliceOptions = {}
  ): Promise<Blob> {
    // JSZip arrives on the click, not on page load. It is 27.5 KiB gzip and
    // only "Slice All Files" needs it — a user who slices one track at a time
    // never downloads it at all. That is standing rule 6 applied to a
    // dependency rather than to a view.
    const { default: JSZip } = await import("jszip");

    const zip = new JSZip();
    const usable = tracks.filter((track) => track.region);

    // `clip-30s.wav` and `clip-30s.mp3` both want to be `sliced_clip-30s.wav`,
    // and `zip.file` overwrites without a word. Three tracks used to come back
    // as two files.
    const taken = new Set<string>();

    for (let index = 0; index < usable.length; index++) {
      const track = usable[index];

      const blob = await this.sliceTrack(track, settings, {
        ...options,
        fileIndex: index,
        fileCount: usable.length,
      });

      if (!blob) continue;

      zip.file(
        uniqueFileName(
          taken,
          this.outputFileName(track.file.name, settings.exportFileType)
        ),
        blob
      );
    }

    return zip.generateAsync({ type: "blob" }, (metadata) => {
      options.onProgress?.({
        fileIndex: Math.max(0, usable.length - 1),
        fileCount: usable.length,
        fileName: "",
        phase: "zip",
        phaseProgress: metadata.percent / 100,
      });
    });
  }
}
