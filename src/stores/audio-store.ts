import { create } from "zustand";
import { BitDepth, OutputFormat } from "@/lib/output-format";
// `import type`, not a plain import. `audio-service` pulls in JSZip, and this
// store is imported by every component. A value import here would put the zip
// library in front of the first waveform.
import type { ExportSettings, SliceProgress } from "@/lib/audio-service";
import { EditStack, Region, defaultRegion } from "@/lib/edit-stack";
import {
  MEMORY_CEILING_BYTES,
  SizedFile,
  admit,
  formatBytes,
} from "@/lib/memory-ceiling";
import { readPersisted, writePersisted } from "@/lib/persisted";
import {
  DEFAULT_VIEW,
  View,
  VIEW_STORAGE_KEY,
  VIEW_STORAGE_VERSION,
  isView,
} from "@/lib/view";
import {
  DEFAULT_MASTER_DEFAULTS,
  MASTER_DEFAULTS_STORAGE_KEY,
  MASTER_DEFAULTS_STORAGE_VERSION,
  MasterDefaults,
  isMasterDefaults,
} from "@/lib/master-defaults";

/**
 * The part of a region this app owns.
 *
 * Never the wavesurfer `Region` object. That is a live object owned by the
 * regions plugin, with its own listeners and its own lifecycle. Holding it in
 * reactive state gives stale reads and update loops, so the plugin object stays
 * inside `AudioEditor` and only plain numbers come out.
 *
 * It is now the edit stack's `Region`, which carries the region's own gain and
 * fade edges beside its bounds. The card still writes only `start` and `end`;
 * `setTrackRegion` keeps the rest.
 */
export type TrackRegion = Region;

export type EditorTrack = {
  file: File;
  region?: TrackRegion;

  /**
   * This track's own stack, when it has one.
   *
   * `undefined` means "inherit the master defaults", and `AudioService.stackFor`
   * turns those two switches into operations. A track only gets a stack of its
   * own once Advanced view can give it one.
   */
  stack?: EditStack;
};

interface AudioState {
  /**
   * Real state, one entry per loaded file.
   *
   * Updated immutably, and only the changed track gets a new object. Every
   * other track keeps its identity, so a card that did not change does not
   * redraw. That is this store's whole job.
   */
  tracks: EditorTrack[];

  /**
   * Takes the uploader's list and merges it into the tracks already loaded.
   *
   * Three things it must do:
   *
   * 1. **Keep regions.** `BrowserMultiFileUpload` rebuilds every track as a
   *    fresh object each time it reports, so a plain replace threw away the
   *    region of every earlier track.
   * 2. **Keep one card per file.** That uploader re-sends its whole history, so
   *    a plain append gave seven cards for four files.
   * 3. **Hold the memory ceiling.** A loaded track costs its whole encoded file
   *    until its card unmounts. A drop that would cross 1 GB is refused, and
   *    nothing already on screen is touched.
   *
   * Files are matched on name. Two different files with the same name collide,
   * which is what `getTrack` already assumed before this rewrite.
   */
  setTracks: (tracks: EditorTrack[]) => void;

  /** A non-reactive read, for event handlers. Components select instead. */
  getTrack: (fileName: string) => EditorTrack | undefined;

  /**
   * Writes a region's bounds, keeping everything else it owns.
   *
   * The card knows the bounds and nothing else. Its gain and its fade edges
   * survive a drag because this merges rather than replaces.
   */
  setTrackRegion: (
    fileName: string,
    bounds: { start: number; end: number }
  ) => void;

  /**
   * Why the last drop was refused, or `null`.
   *
   * The memory ceiling refuses, it never evicts. This is the reason the user is
   * shown, and it is cleared by the next drop that succeeds.
   */
  refusal: string | null;
  clearRefusal: () => void;

  normalizeAudio: boolean;
  setNormalizeAudio: (normalize: boolean) => void;

  applyPostProcessing: boolean;
  setApplyPostProcessing: (apply: boolean) => void;

  /**
   * What "Normalize Levels? Yes" aims at, in LUFS. Advanced view only.
   *
   * Simple view gains no control for it — that is ticket 010's rule — but it
   * still reads this value, so an Advanced user's choice applies in both views.
   * Standing rule 5: switching views never loses work.
   */
  loudnessTargetLufs: number;
  setLoudnessTargetLufs: (target: number) => void;

  exportFileType: OutputFormat;
  setExportFileType: (fileType: OutputFormat) => void;

  /**
   * Bits per stored sample, for WAV and FLAC. Advanced view only.
   *
   * Simple view has no control for it and always exports at 16, because that is
   * this value's default and Simple never changes it. An Advanced user's choice
   * survives a switch to Simple — standing rule 5 — and the chip says so.
   */
  bitDepth: BitDepth;
  setBitDepth: (bitDepth: BitDepth) => void;

  /**
   * The rate to export at, in hertz, or `null` for the file's own rate.
   *
   * Advanced view only, and `null` is the rule for everyone else.
   */
  outputSampleRate: number | null;
  setOutputSampleRate: (sampleRate: number | null) => void;

  processingLoading: boolean;
  setProcessingLoading: (loading: boolean) => void;

  /**
   * Where the running export has got to, or `null` when nothing is running.
   *
   * Standing rule 7: anything over 300 ms shows progress. A batch of ten
   * 5-minute MP3s is most of a minute.
   */
  sliceProgress: SliceProgress | null;
  setSliceProgress: (progress: SliceProgress | null) => void;

  /**
   * Which set of controls is on screen.
   *
   * This is the *stored* view. What the user actually gets is the effective
   * view, which is Simple below 800 px. See `useEffectiveView`.
   */
  view: View;
  setView: (view: View) => void;
}

const storedMasterDefaults: MasterDefaults =
  readPersisted(
    MASTER_DEFAULTS_STORAGE_KEY,
    MASTER_DEFAULTS_STORAGE_VERSION,
    isMasterDefaults
  ) ?? DEFAULT_MASTER_DEFAULTS;

export const useAudioStore = create<AudioState>((set, get) => {
  /** Writes the whole master defaults object, with one key changed. */
  const persistMasterDefault = <K extends keyof MasterDefaults>(
    key: K,
    value: MasterDefaults[K]
  ) => {
    const {
      normalizeAudio,
      applyPostProcessing,
      loudnessTargetLufs,
      exportFileType,
      bitDepth,
      outputSampleRate,
    } = get();

    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      {
        normalizeAudio,
        applyPostProcessing,
        loudnessTargetLufs,
        exportFileType,
        bitDepth,
        outputSampleRate,
        [key]: value,
      }
    );
  };

  return {
    tracks: [],
    refusal: null,

    setTracks: (incoming: EditorTrack[]) => {
      const existing = get().tracks;
      const merged: EditorTrack[] = [];
      const seen = new Set<string>();
      const fresh: EditorTrack[] = [];

      for (const track of incoming) {
        const name = track.file.name;
        if (seen.has(name)) continue;
        seen.add(name);

        // Keep the object already in the store, so its region survives and its
        // card keeps the identity that stops it redrawing.
        const known = existing.find((t) => t.file.name === name);
        if (known) merged.push(known);
        else fresh.push(track);
      }

      const held = merged.map((track) => track.file);
      const { accepted, refused } = admit(
        held,
        fresh.map((track) => track.file)
      );

      // `admit` judges files, because its rule is about encoded bytes. The
      // store holds tracks, so the answer is mapped back by name — the same key
      // the merge above uses.
      const allowed = new Set(accepted.map((file) => file.name));

      set({
        tracks: [
          ...merged,
          ...fresh.filter((track) => allowed.has(track.file.name)),
        ],
        // The message counts what is held *after* this drop, so it must include
        // the files this same drop accepted. Counting only `held` reported
        // "already holding 0.0 MB" while two 476 MB files were going in beside
        // the one it refused.
        refusal: refused.length
          ? refusalMessage(refused, [...held, ...accepted])
          : null,
      });
    },

    clearRefusal: () => set({ refusal: null }),

    getTrack: (fileName: string) =>
      get().tracks.find((track) => track.file.name === fileName),

    setTrackRegion: (
      fileName: string,
      bounds: { start: number; end: number }
    ) => {
      set({
        tracks: get().tracks.map((track) =>
          track.file.name === fileName
            ? {
                ...track,
                region: track.region
                  ? { ...track.region, ...bounds }
                  : defaultRegion(bounds.start, bounds.end),
              }
            : track
        ),
      });
    },

    normalizeAudio: storedMasterDefaults.normalizeAudio,

    setNormalizeAudio: (normalizeAudio: boolean) => {
      persistMasterDefault("normalizeAudio", normalizeAudio);
      set({ normalizeAudio });
    },

    applyPostProcessing: storedMasterDefaults.applyPostProcessing,

    setApplyPostProcessing: (applyPostProcessing: boolean) => {
      persistMasterDefault("applyPostProcessing", applyPostProcessing);
      set({ applyPostProcessing });
    },

    loudnessTargetLufs: storedMasterDefaults.loudnessTargetLufs,

    setLoudnessTargetLufs: (loudnessTargetLufs: number) => {
      persistMasterDefault("loudnessTargetLufs", loudnessTargetLufs);
      set({ loudnessTargetLufs });
    },

    exportFileType: storedMasterDefaults.exportFileType,

    setExportFileType: (exportFileType: OutputFormat) => {
      persistMasterDefault("exportFileType", exportFileType);
      set({ exportFileType });
    },

    bitDepth: storedMasterDefaults.bitDepth,

    setBitDepth: (bitDepth: BitDepth) => {
      persistMasterDefault("bitDepth", bitDepth);
      set({ bitDepth });
    },

    outputSampleRate: storedMasterDefaults.outputSampleRate,

    setOutputSampleRate: (outputSampleRate: number | null) => {
      persistMasterDefault("outputSampleRate", outputSampleRate);
      set({ outputSampleRate });
    },

    processingLoading: false,

    setProcessingLoading: (processingLoading: boolean) =>
      set({ processingLoading }),

    sliceProgress: null,

    setSliceProgress: (sliceProgress: SliceProgress | null) =>
      set({ sliceProgress }),

    view:
      readPersisted(VIEW_STORAGE_KEY, VIEW_STORAGE_VERSION, isView) ??
      DEFAULT_VIEW,

    setView: (view: View) => {
      writePersisted(VIEW_STORAGE_KEY, VIEW_STORAGE_VERSION, view);
      set({ view });
    },
  };
});

/**
 * The master defaults, as the engine reads them.
 *
 * Read at click time, never subscribed to, so a card that shows an export button
 * does not redraw when a master default changes. Two call sites use it — the
 * master toolbar and a track card — and they must agree, because a setting one
 * of them forgets is a setting that silently does nothing.
 *
 * `outputSampleRate` changes shape here: the store keeps `null` because
 * `localStorage` cannot hold `undefined`, and the engine reads `undefined`
 * because an absent setting is what "the file's own rate" means to it.
 */
export function masterExportSettings(): ExportSettings {
  const {
    normalizeAudio,
    applyPostProcessing,
    loudnessTargetLufs,
    exportFileType,
    bitDepth,
    outputSampleRate,
  } = useAudioStore.getState();

  return {
    normalizeAudio,
    applyPostProcessing,
    loudnessTargetLufs,
    exportFileType,
    bitDepth,
    outputSampleRate: outputSampleRate ?? undefined,
  };
}

function refusalMessage(refused: SizedFile[], kept: SizedFile[]): string {
  const held = kept.reduce((sum, file) => sum + file.size, 0);
  const names = refused.map((file) => file.name).join(", ");

  return (
    `${refused.length === 1 ? "This file was" : "These files were"} not ` +
    `loaded: ${names}. SoundSlice holds ` +
    `${formatBytes(MEMORY_CEILING_BYTES)} of audio at once and is now ` +
    `holding ${formatBytes(held)}. Nothing already loaded was removed.`
  );
}
