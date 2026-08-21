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
import { measureStack, renderRegions } from "./render";
import {
  measurementKey,
  recallMeasurement,
  rememberMeasurement,
} from "./preview-measurements";
import { encode } from "./encoder";
import {
  BitDepth,
  DEFAULT_BIT_DEPTH,
  FORMAT_EXTENSION,
  OutputFormat,
  exportSampleRate,
} from "./output-format";
import { outputFileName, regionFileName, uniqueFileName } from "./file-names";
import {
  EditStack,
  Region,
  firstRegion,
  needsMeasurement,
  orderedRegions,
  simpleStack,
} from "./edit-stack";

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

  /**
   * **Join** — one file per track instead of one per region.
   *
   * The regions are laid end to end in the order the plan gives them, with no
   * overlap and no crossfade. Each keeps its own gain and its own fade edges,
   * so a seam is a fade-out immediately followed by a fade-in. Split on silence
   * already keeps padding at each end for exactly that reason, which is why
   * this is the right shape for de-silencing a recording.
   *
   * The stack runs **once** over the joined audio, so a compressor keeps its
   * envelope across the seams and a loudness operation resolves to one gain for
   * the file. That is the difference between joining and gluing N exports
   * together afterwards.
   *
   * Optional, and it defaults to false, so every existing caller — the
   * benchmark harness included — keeps today's behaviour without knowing the
   * field exists.
   */
  joinRegions?: boolean;
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

/**
 * One region of one track, and the name its file will carry.
 *
 * An export plans every output before it renders any of them. Two reasons, and
 * both are in ticket 023's acceptance:
 *
 * 1. **Progress counts regions, not tracks.** Ten tracks of six regions is sixty
 *    renders, and a bar that counts ten sits at 10% for a long time.
 * 2. **Names are made unique against the whole export**, not against one track,
 *    so two tracks that each hold a region called "chorus" both arrive.
 */
export type SlicePlanItem = {
  track: EditorTrack;

  /**
   * The regions this one file holds, in output order.
   *
   * One entry is the ordinary case. Many is a **join** — `joinRegions` makes
   * the unit of output a *track*, so the item carries every region it has.
   *
   * A plan item was already the unit of output, which is why progress needed no
   * new code: the bar counts output files either way.
   */
  regions: Region[];
  /** Already unique, already sanitised. Ready for `zip.file`. */
  name: string;
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
   * The gains this track's stack resolves to, measured if nobody has yet.
   *
   * Preview's entry point. It decodes, runs the measuring passes, and **drops
   * the buffer** — only the numbers are kept. That is the worker boundary
   * design's section 6 held to: a decoded 45-minute track is 1.04 GB, and
   * holding one is the difference between a tab that survives and a tab that
   * dies.
   *
   * A stack with nothing to measure returns an empty map at once and costs
   * nothing, so a caller need not check first.
   *
   * The rate is the **export** rate, not the file's own. Preview plays the media
   * element at whatever rate the file is, but the gain it applies has to be the
   * gain the export would apply, or the two disagree about level — which is the
   * one thing ADR 0001 exists to stop.
   */
  static async measureFor(
    track: EditorTrack,
    region: Region | undefined,
    settings: ExportSettings
  ): Promise<ReadonlyMap<number, number>> {
    const regions = this.measuredRegions(track, region, settings);
    if (regions.length === 0) return new Map();

    const stack = this.stackFor(track, settings);
    if (!stack.some((operation) => needsMeasurement(operation))) return new Map();

    const fileRate = await AudioLoader.sampleRateOf(track.file);
    const rate = this.exportSampleRate(fileRate, settings);
    const key = measurementKey(track.file.name, regions, stack, rate);

    const known = recallMeasurement(key);
    if (known) return known;

    const source = await AudioLoader.loadAudioFile(track.file, () => rate);
    const measured = await measureStack(source, regions, stack);

    rememberMeasurement(key, measured);
    return measured;
  }

  /**
   * What preview has to measure to hear the level this export will produce.
   *
   * **With join on, that is the whole track, not the selected region.** A join
   * resolves a loudness or peak-normalization operation to one gain for the
   * entire joined file. Measuring one region would give preview a different
   * gain from the one the export applies — and the output meter would then show
   * a level the file will not have. [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md)
   * exists to stop precisely that, and this session has already had to fix one
   * such divergence worth 0.541 dB.
   *
   * With join off it is the selected region, which is what it always was.
   */
  private static measuredRegions(
    track: EditorTrack,
    region: Region | undefined,
    settings: ExportSettings
  ): Region[] {
    if (settings.joinRegions) return orderedRegions(track.regions);
    return region ? [region] : [];
  }

  /**
   * Plans every file this export will write, before it renders any of them.
   *
   * Names are made unique against `taken`, which the caller owns and shares
   * across the whole export. Two tracks that each hold a region named "chorus"
   * therefore give `..._chorus.wav` and `..._chorus (2).wav`, and neither is
   * lost — `zip.file` overwrites without a word, which is the defect
   * `uniqueFileName` exists to stop.
   *
   * A track with no regions contributes nothing. It is not an error and it is
   * not silent either: the caller can see the plan is shorter than the track
   * list and say so.
   */
  static planSlices(
    tracks: EditorTrack[],
    settings: ExportSettings,
    taken = new Set<string>(),
    prefix = "sliced_"
  ): SlicePlanItem[] {
    const extension = FORMAT_EXTENSION[settings.exportFileType];
    const plan: SlicePlanItem[] = [];

    for (const track of tracks) {
      const ordered = orderedRegions(track.regions);

      // Zero regions exports nothing. Skipping here rather than downstream is
      // what keeps `renderRegions`' own guard unreachable in practice.
      if (ordered.length === 0) continue;

      // **Join: one item per track.** `outputFileName` has been the right namer
      // for a single output file since it was written, and this is its first
      // caller. It gives a one-region track the same name join gives it, so
      // turning join on cannot rename a file that was already alone.
      if (settings.joinRegions) {
        plan.push({
          track,
          regions: ordered,
          name: uniqueFileName(
            taken,
            outputFileName(track.file.name, extension, prefix)
          ),
        });
        continue;
      }

      ordered.forEach((region, index) => {
        plan.push({
          track,
          regions: [region],
          name: uniqueFileName(
            taken,
            regionFileName(
              track.file.name,
              extension,
              {
                name: region.name,
                number: index + 1,
                onlyRegion: ordered.length === 1,
              },
              prefix
            )
          ),
        });
      });
    }

    return plan;
  }

  /**
   * Renders regions of one track through its stack, into one file.
   *
   * One region is the ordinary slice. Several are **joined** — laid end to end
   * with the stack run once over all of them. The order is the caller's; this
   * does not sort.
   *
   * Returns `null` when the export was cancelled. The returned `Blob` is the
   * caller's to keep or discard.
   */
  static async sliceRegions(
    track: EditorTrack,
    regions: readonly Region[],
    settings: ExportSettings,
    options: SliceOptions & {
      fileIndex?: number;
      fileCount?: number;
      /** What the progress line calls this output. Defaults to the source file. */
      outputName?: string;
      /**
       * A buffer already decoded from this track's file, at this export's rate.
       *
       * `renderPlan` passes one so that six regions of one track cost **one**
       * decode instead of six. It stays the caller's — this method must not
       * transfer it, and does not: only the freshly rendered buffer is
       * transferred, a few lines below.
       */
      source?: AudioBuffer;
    } = {}
  ): Promise<Blob | null> {
    const report = (phase: SlicePhase, phaseProgress: number) =>
      options.onProgress?.({
        fileIndex: options.fileIndex ?? 0,
        fileCount: options.fileCount ?? 1,
        fileName: options.outputName ?? track.file.name,
        phase,
        phaseProgress,
      });

    // One decode per output file, at the one rate this export uses — or none at
    // all when the caller has already decoded this track. Nothing here caches
    // it: the design's section 6 forbids caching, and that is what makes the
    // transfer below safe.
    const source =
      options.source ??
      (await AudioLoader.loadAudioFile(track.file, (fileRate) =>
        this.exportSampleRate(fileRate, settings)
      ));

    const stack = this.stackFor(track, settings);

    const rendered = await renderRegions(source, regions, stack, {
      onProgress: (fraction) => report("render", fraction),
      isCancelled: options.isCancelled,
      // An export is the most expensive way to learn these gains, and it has
      // just paid for them. Preview reads the same numbers, so the next press of
      // play is instant and hears exactly what was sliced.
      onMeasured: (measured) =>
        rememberMeasurement(
          measurementKey(
            track.file.name,
            regions,
            stack,
            source.sampleRate
          ),
          measured
        ),
    });

    // `rendered` is fresh and nothing else holds it, so its channels are
    // transferred rather than copied. Transferring detaches the whole
    // `AudioBuffer`; nothing reads it after this line.
    return encode(rendered, settings.exportFileType, {
      bitDepth: settings.bitDepth ?? DEFAULT_BIT_DEPTH,
      onProgress: (fraction) => report("encode", fraction),
    }).done;
  }

  /**
   * Renders one track's **first region by start time**.
   *
   * What Simple view exports, and what the benchmark harness measures. A track
   * with many regions has more files than this, and `sliceTrackFiles` is the one
   * that gives them all — this is deliberately the one-file answer and it is
   * named for what it returns.
   *
   * Returns `null` for a track with no regions, and for a cancelled export.
   */
  static async sliceTrack(
    track: EditorTrack,
    settings: ExportSettings,
    options: SliceOptions & { fileIndex?: number; fileCount?: number } = {}
  ): Promise<Blob | null> {
    const region = firstRegion(track.regions);
    if (!region) return null;

    return this.sliceRegions(track, [region], settings, options);
  }

  /**
   * Every file one track exports, named and in start-time order.
   *
   * Empty for a track with no regions, which is legal and is **not** success:
   * the caller must say nothing was exported rather than report a download that
   * did not happen. That is the shape of the defect ticket 016 fixed.
   */
  static async sliceTrackFiles(
    track: EditorTrack,
    settings: ExportSettings,
    options: SliceOptions & { prefix?: string } = {}
  ): Promise<Array<{ name: string; blob: Blob }>> {
    const plan = this.planSlices(
      [track],
      settings,
      new Set<string>(),
      options.prefix
    );

    return this.renderPlan(plan, settings, options);
  }

  /**
   * Slices every region of every track into one zip.
   *
   * Serial, one file at a time, exactly as before. Overlapping the encode of
   * file *N* with the render of file *N+1* is possible with one worker and no
   * pool, and the worker boundary design deliberately does not build it: it
   * doubles peak memory to save a share of the work nobody has measured.
   *
   * **The unit is a region, not a track.** Sixty regions across ten tracks is
   * sixty renders and the bar says so.
   */
  static async sliceAllFilesIntoZip(
    tracks: EditorTrack[],
    settings: ExportSettings,
    options: SliceOptions = {}
  ): Promise<Blob> {
    // One `taken` set for the whole export. `clip-30s.wav` and `clip-30s.mp3`
    // both want to be `sliced_clip-30s.wav`, and `zip.file` overwrites without
    // a word. Three tracks used to come back as two files.
    const plan = this.planSlices(tracks, settings);
    const files = await this.renderPlan(plan, settings, options);

    return this.zipFiles(files, (fraction) =>
      options.onProgress?.({
        fileIndex: Math.max(0, plan.length - 1),
        fileCount: plan.length,
        fileName: "",
        phase: "zip",
        phaseProgress: fraction,
      })
    );
  }

  /**
   * Puts already-named files into one zip.
   *
   * JSZip arrives on the call, not on page load. It is 27.5 KiB gzip and only an
   * export of more than one file needs it — a user who slices one region at a
   * time never downloads it at all. That is standing rule 6 applied to a
   * dependency rather than to a view.
   *
   * Every blob goes in as a `Blob`. None of them becomes a URL, so none of them
   * is a leak — ticket 018's rule, and the reason `download.ts` is the only
   * place an export blob URL exists.
   */
  static async zipFiles(
    files: Array<{ name: string; blob: Blob }>,
    onProgress?: (fraction: number) => void
  ): Promise<Blob> {
    const { default: JSZip } = await import("jszip");

    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file.blob);

    return zip.generateAsync({ type: "blob" }, (metadata) =>
      onProgress?.(metadata.percent / 100)
    );
  }

  /**
   * Renders a plan in order, reporting progress across the whole of it.
   *
   * ## One decode per track, not one per file
   *
   * `sliceRegions` decodes the track's file when nobody hands it a buffer, so
   * six regions of one track used to cost **six** full reads and six
   * `decodeAudioData` calls of the same bytes. `planSlices` emits every item of
   * a track together, so remembering the last decode and reusing it while the
   * file name holds is enough to make that one decode.
   *
   * **It holds at most one buffer at a time.** Moving to a new track drops the
   * old one on the same line that replaces it, so peak memory is exactly what
   * it was: one decoded track, plus whatever the render in flight allocates.
   * A map keyed by file name would hold every track at once and break the
   * memory ceiling ticket 007 set.
   *
   * The buffer is never transferred. Only the freshly rendered output is, and
   * `sliceRegions` owns that.
   */
  private static async renderPlan(
    plan: SlicePlanItem[],
    settings: ExportSettings,
    options: SliceOptions
  ): Promise<Array<{ name: string; blob: Blob }>> {
    const files: Array<{ name: string; blob: Blob }> = [];

    let decodedName: string | null = null;
    let decoded: AudioBuffer | null = null;

    for (let index = 0; index < plan.length; index++) {
      const item = plan[index];

      if (decodedName !== item.track.file.name) {
        // Dropped before the next is made, so two never exist together.
        decoded = null;
        decodedName = null;

        decoded = await AudioLoader.loadAudioFile(
          item.track.file,
          (fileRate) => this.exportSampleRate(fileRate, settings)
        );
        decodedName = item.track.file.name;
      }

      const blob = await this.sliceRegions(item.track, item.regions, settings, {
        ...options,
        fileIndex: index,
        fileCount: plan.length,
        outputName: item.name,
        source: decoded ?? undefined,
      });

      if (!blob) continue;
      files.push({ name: item.name, blob });
    }

    return files;
  }
}
