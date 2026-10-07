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
import {
  RenderCancelled,
  concatenate,
  measureStack,
  renderRegions,
} from "./render";
import {
  measurementKey,
  recallMeasurement,
  rememberMeasurement,
} from "./preview-measurements";
import { cancel, encode } from "./encoder";
import {
  BitDepth,
  DEFAULT_BIT_DEPTH,
  FORMAT_EXTENSION,
  OutputFormat,
  exportSampleRate,
} from "./output-format";
import { outputFileName } from "./file-names";
import {
  EditStack,
  Region,
  firstRegion,
  isStretched,
  needsMeasurement,
  simpleStack,
  withNoiseFirst,
} from "./edit-stack";
// `import type`: the prepare stage is loaded only by a render that has noise
// reduction or a stretched region. See `prepared` below.
import type { Prepared } from "./prepare-source";
import type { JoinMode } from "./master-defaults";
import { joins } from "./master-defaults";
import { effectiveExportSettings } from "./track-work";
import {
  SlicePart,
  SlicePlanItem,
  joinedPart,
  planSlices,
} from "./slice-plan";

export type { SlicePart, SlicePlanItem };

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
   * **Join** — how many files an export writes. See `MasterDefaults.joinMode`.
   *
   * - `separate`: one per region.
   * - `track`: one per track. Its regions are laid end to end in the track's
   *   join order, butt-joined or crossfaded seam by seam, and the stack runs
   *   **once** over the joined audio — so a compressor keeps its envelope across
   *   the seams and a loudness operation resolves to one gain for the file.
   * - `all`: one for the whole export. Each track's join goes through that
   *   track's own stack, and the tracks are then laid end to end in card order.
   *
   * Optional, and absent means `separate`, so every existing caller — the
   * benchmark harness included — keeps today's behaviour without knowing the
   * field exists.
   */
  joinMode?: JoinMode;
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

  /**
   * The user's **Cancel**. Ticket 035.
   *
   * Read between render passes, between output files, and — through the encode
   * worker's own `cancel` message — between encode chunks. An export that sees
   * it abort stops at the next of those, writes nothing, and resolves to
   * `null`. Nothing half-made is ever handed back.
   */
  signal?: AbortSignal;
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
    return track.stack ? withNoiseFirst(track.stack) : simpleStack(settings);
  }

  /**
   * The settings one track exports with: the master's, with that track's own
   * export overrides on top. Ticket 033.
   *
   * A join across tracks is the exception. It writes one file, so it has one
   * format and one rate, and those are the master's.
   */
  static settingsFor(track: EditorTrack, master: ExportSettings): ExportSettings {
    if (master.joinMode === "all") return master;
    return effectiveExportSettings(master, track.exportOverrides);
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
   * The rate is the **export** rate, not the file's own — and this track's
   * export rate, overrides included. Preview plays the media element at
   * whatever rate the file is, but the gain it applies has to be the gain the
   * export would apply, or the two disagree about level — which is the one
   * thing ADR 0001 exists to stop.
   */
  static async measureFor(
    track: EditorTrack,
    region: Region | undefined,
    master: ExportSettings
  ): Promise<ReadonlyMap<number, number>> {
    const settings = this.settingsFor(track, master);
    const part = this.measuredPart(track, region, settings);
    if (part.regions.length === 0) return new Map();

    const stack = this.stackFor(track, settings);
    if (!stack.some((operation) => needsMeasurement(operation))) return new Map();

    const fileRate = await AudioLoader.sampleRateOf(track.file);
    const rate = this.exportSampleRate(fileRate, settings);
    const key = measurementKey(
      track.file.name,
      part.regions,
      stack,
      rate,
      part.crossfadesMs
    );

    const known = recallMeasurement(key);
    if (known) return known;

    const decoded = await AudioLoader.loadAudioFile(track.file, () => rate);

    // Denoised and stretched first, exactly as the export does, or preview
    // would measure audio the file does not contain.
    const prepared = await this.prepared(decoded, part.regions, stack);
    const measured = shiftMeasured(
      await measureStack(prepared.source, prepared.regions, prepared.stack, {
        crossfadesMs: part.crossfadesMs,
      }),
      prepared.indexShift
    );

    rememberMeasurement(key, measured);
    return measured;
  }

  /**
   * What preview has to measure to hear the level this export will produce.
   *
   * **With join on, that is the track's whole join, not the selected region** —
   * in its join order and with its crossfades, because both change what a
   * loudness pass hears. A join resolves a loudness or peak-normalization
   * operation to one gain for the entire joined file. Measuring one region
   * would give preview a different gain from the one the export applies — and
   * the output meter would then show a level the file will not have.
   * [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md) exists to stop
   * precisely that, and this session has already had to fix one such
   * divergence worth 0.541 dB.
   *
   * A join across tracks measures each track's own join, because each track
   * goes through its own stack before the tracks are laid end to end.
   *
   * With join off it is the selected region, which is what it always was.
   */
  private static measuredPart(
    track: EditorTrack,
    region: Region | undefined,
    settings: ExportSettings
  ): SlicePart {
    if (joins(settings.joinMode ?? "separate")) return joinedPart(track);
    return { track, regions: region ? [region] : [], crossfadesMs: [0] };
  }

  /**
   * Plans every file this export will write, before it renders any of them.
   *
   * The rule lives in [`slice-plan.ts`](./slice-plan.ts), where Vitest can read
   * it. Names are made unique against `taken`, which the caller owns and shares
   * across the whole export.
   */
  static planSlices(
    tracks: EditorTrack[],
    settings: ExportSettings,
    taken = new Set<string>(),
    prefix = "sliced_"
  ): SlicePlanItem[] {
    return planSlices(tracks, settings, taken, prefix);
  }

  /**
   * Renders regions of one track through its stack, into one file.
   *
   * One region is the ordinary slice. Several are **joined** — laid end to end
   * with the stack run once over all of them. The order is the caller's; this
   * does not sort.
   *
   * `settings` are used as given. A caller that wants this track's export
   * overrides passes `settingsFor(track, master)`.
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
      /** The crossfade into each region from the one before it, in milliseconds. */
      crossfadesMs?: readonly number[];
      /**
       * A buffer already decoded from this track's file, at this export's rate.
       *
       * `renderPlan` passes one so that six regions of one track cost **one**
       * decode instead of six. It stays the caller's — this method must not
       * transfer it, and does not: only the freshly rendered buffer is
       * transferred, by `encodeOrCancel`.
       */
      source?: AudioBuffer;
    } = {}
  ): Promise<Blob | null> {
    const report = reporter(options, options.outputName ?? track.file.name);

    try {
      const rendered = await this.renderPart(
        {
          track,
          regions: [...regions],
          crossfadesMs: [...(options.crossfadesMs ?? regions.map(() => 0))],
        },
        settings,
        options.source ?? (await this.decode(track, settings)),
        options.signal,
        (fraction) => report("render", fraction)
      );

      return await this.encodeOrCancel(rendered, settings, options.signal, (fraction) =>
        report("encode", fraction)
      );
    } catch (error) {
      if (error instanceof RenderCancelled) return null;
      throw error;
    }
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
   *
   * `null` when the export was cancelled. Not an empty list: "you cancelled"
   * and "there was nothing to export" are different things to tell a user.
   */
  static async sliceTrackFiles(
    track: EditorTrack,
    master: ExportSettings,
    options: SliceOptions & { prefix?: string } = {}
  ): Promise<Array<{ name: string; blob: Blob }> | null> {
    // One card's own button exports one track, so "join every track" means
    // nothing here. It joins this track, which is what that card holds.
    const settings: ExportSettings =
      master.joinMode === "all" ? { ...master, joinMode: "track" } : master;

    const plan = this.planSlices(
      [track],
      settings,
      new Set<string>(),
      options.prefix
    );

    return this.renderPlan(plan, options);
  }

  /**
   * Slices every region of every track into one zip.
   *
   * Serial, one file at a time, exactly as before. Overlapping the encode of
   * file *N* with the render of file *N+1* is possible with one worker and no
   * pool, and the worker boundary design deliberately does not build it: it
   * doubles peak memory to save a share of the work nobody has measured.
   *
   * **The unit is an output file, not a track.** Sixty regions across ten
   * tracks is sixty renders and the bar says so.
   *
   * `null` when the export was cancelled. A half-built zip is never made.
   */
  static async sliceAllFilesIntoZip(
    tracks: EditorTrack[],
    settings: ExportSettings,
    options: SliceOptions = {}
  ): Promise<Blob | null> {
    // One `taken` set for the whole export. `clip-30s.wav` and `clip-30s.mp3`
    // both want to be `sliced_clip-30s.wav`, and `zip.file` overwrites without
    // a word. Three tracks used to come back as two files.
    const plan = this.planSlices(tracks, settings);
    const files = await this.renderPlan(plan, options);
    if (!files || options.signal?.aborted) return null;

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
   * Six regions of one track used to cost **six** full reads and six
   * `decodeAudioData` calls of the same bytes. `planSlices` emits every item of
   * a track together, so remembering the last decode and reusing it while the
   * file and the rate hold is enough to make that one decode.
   *
   * **It holds at most one buffer at a time** for an ordinary export. Moving to
   * a new track drops the old one on the same line that replaces it, so peak
   * memory is exactly what it was: one decoded track, plus whatever the render
   * in flight allocates. A map keyed by file name would hold every track at
   * once and break the memory ceiling ticket 007 set.
   *
   * A join across tracks holds each track's **rendered** join until the last
   * one is done, because they become one file. That is the size of the output,
   * which the encoder has to hold anyway.
   *
   * `null` when the export was cancelled.
   */
  private static async renderPlan(
    plan: SlicePlanItem[],
    options: SliceOptions
  ): Promise<Array<{ name: string; blob: Blob }> | null> {
    const files: Array<{ name: string; blob: Blob }> = [];
    const { signal } = options;

    let decodedKey: string | null = null;
    let decoded: AudioBuffer | null = null;

    /** This track, at this rate. Reused while both hold. */
    const sourceFor = async (
      track: EditorTrack,
      settings: ExportSettings,
      rate?: number
    ): Promise<AudioBuffer> => {
      const fileRate = rate ?? (await AudioLoader.sampleRateOf(track.file));
      const exportRate = rate ?? this.exportSampleRate(fileRate, settings);
      const key = `${track.file.name}@${exportRate}`;
      if (decoded && decodedKey === key) return decoded;

      // Dropped before the next is made, so two never exist together.
      decoded = null;
      decodedKey = null;

      decoded = await AudioLoader.loadAudioFile(track.file, () => exportRate);
      decodedKey = key;
      return decoded;
    };

    try {
      for (let index = 0; index < plan.length; index++) {
        if (signal?.aborted) return null;

        const item = plan[index];
        const report = reporter(
          { ...options, fileIndex: index, fileCount: plan.length },
          item.name
        );

        // A join across tracks renders every track at **one** rate, or the
        // buffers could not be laid end to end. The first track's export rate
        // is that rate: with no rate chosen, a set of 44.1 kHz recordings keeps
        // 44.1 kHz rather than being resampled for no reason.
        const sharedRate =
          item.parts.length > 1
            ? this.exportSampleRate(
                await AudioLoader.sampleRateOf(item.parts[0].track.file),
                item.settings
              )
            : undefined;

        const rendered: AudioBuffer[] = [];
        for (let part = 0; part < item.parts.length; part++) {
          const { track } = item.parts[part];
          const source = await sourceFor(track, item.settings, sharedRate);

          rendered.push(
            await this.renderPart(
              item.parts[part],
              item.settings,
              source,
              signal,
              (fraction) =>
                report("render", (part + fraction) / item.parts.length)
            )
          );
        }

        const output =
          rendered.length === 1 ? rendered[0] : await concatenate(rendered);
        rendered.length = 0;

        const blob = await this.encodeOrCancel(
          output,
          item.settings,
          signal,
          (fraction) => report("encode", fraction)
        );

        if (!blob) return null;
        files.push({ name: item.name, blob });
      }
    } catch (error) {
      if (error instanceof RenderCancelled) return null;
      throw error;
    }

    return signal?.aborted ? null : files;
  }

  /**
   * The source, regions and stack the graph should render — after noise
   * reduction and time and pitch, when this render has either.
   *
   * With neither, it is what it was given and nothing is loaded. With either,
   * `prepare-source.ts` arrives on the call: Simple view's bundle does not
   * carry a stage most exports never use. Standing rule 6.
   */
  private static async prepared(
    source: AudioBuffer,
    regions: readonly Region[],
    stack: EditStack,
    options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
  ): Promise<Prepared> {
    if (!needsPreparing(regions, stack)) {
      return { source, regions: [...regions], stack, indexShift: 0 };
    }

    const { prepareSource } = await import("./prepare-source");
    return prepareSource(source, regions, stack, options);
  }

  /** Decodes a track at the rate these settings export it at. */
  private static decode(
    track: EditorTrack,
    settings: ExportSettings
  ): Promise<AudioBuffer> {
    return AudioLoader.loadAudioFile(track.file, (fileRate) =>
      this.exportSampleRate(fileRate, settings)
    );
  }

  /**
   * One track's share of one output, rendered through that track's stack.
   *
   * The source is the caller's and is never transferred. The result is fresh.
   */
  private static async renderPart(
    part: SlicePart,
    settings: ExportSettings,
    source: AudioBuffer,
    signal: AbortSignal | undefined,
    onProgress: (fraction: number) => void
  ): Promise<AudioBuffer> {
    const { track, regions, crossfadesMs } = part;
    const stack = this.stackFor(track, settings);

    // Noise reduction and time and pitch, when this part has any. The first
    // tenth of the bar, because the graph that follows is most of the work.
    const preparing = needsPreparing(regions, stack);
    const prepared = await this.prepared(source, regions, stack, {
      signal,
      onProgress: (fraction) => onProgress(fraction * 0.1),
    });

    return renderRegions(prepared.source, prepared.regions, prepared.stack, {
      onProgress: preparing
        ? (fraction) => onProgress(0.1 + fraction * 0.9)
        : onProgress,
      isCancelled: () => signal?.aborted ?? false,
      crossfadesMs,
      // An export is the most expensive way to learn these gains, and it has
      // just paid for them. Preview reads the same numbers, so the next press of
      // play is instant and hears exactly what was sliced.
      onMeasured: (measured) =>
        rememberMeasurement(
          measurementKey(
            track.file.name,
            regions,
            stack,
            source.sampleRate,
            crossfadesMs
          ),
          shiftMeasured(measured, prepared.indexShift)
        ),
    });
  }

  /**
   * Encodes a fresh render, or gives up when the user cancels.
   *
   * `rendered` is fresh and nothing else holds it, so its channels are
   * transferred rather than copied. Transferring detaches the whole
   * `AudioBuffer`; nothing reads it after this call.
   */
  private static async encodeOrCancel(
    rendered: AudioBuffer,
    settings: ExportSettings,
    signal: AbortSignal | undefined,
    onProgress: (fraction: number) => void
  ): Promise<Blob | null> {
    if (signal?.aborted) return null;

    const job = encode(rendered, settings.exportFileType, {
      bitDepth: settings.bitDepth ?? DEFAULT_BIT_DEPTH,
      onProgress,
    });

    const stop = () => cancel(job.id);
    signal?.addEventListener("abort", stop, { once: true });

    try {
      return await job.done;
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  }
}

/** Progress for one output file, in the shape the overlay reads. */
function reporter(
  options: SliceOptions & { fileIndex?: number; fileCount?: number },
  fileName: string
) {
  return (phase: SlicePhase, phaseProgress: number) =>
    options.onProgress?.({
      fileIndex: options.fileIndex ?? 0,
      fileCount: options.fileCount ?? 1,
      fileName,
      phase,
      phaseProgress,
    });
}

/** True when this render needs the worker before the graph. */
function needsPreparing(regions: readonly Region[], stack: EditStack): boolean {
  return stack[0]?.op === "noiseReduction" || regions.some(isStretched);
}

/** Moves measured gains from the prepared stack's indices to the original's. */
function shiftMeasured(
  measured: ReadonlyMap<number, number>,
  by: number
): Map<number, number> {
  if (by === 0) return new Map(measured);
  return new Map([...measured].map(([index, gain]) => [index + by, gain]));
}
