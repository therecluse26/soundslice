import { create } from "zustand";
import { OutputFormat } from "@/lib/audio-service";
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
 * The part of a region this app owns: two numbers, in seconds.
 *
 * Never the wavesurfer `Region` object. That is a live object owned by the
 * regions plugin, with its own listeners and its own lifecycle. Holding it in
 * reactive state gives stale reads and update loops, so the plugin object stays
 * inside `AudioEditor` and only these two numbers come out.
 */
export type TrackRegion = {
  start: number;
  end: number;
};

export type EditorTrack = {
  file: File;
  region?: TrackRegion;
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
   * Two things it must do, and both are defects it fixes:
   *
   * 1. **Keep regions.** `BrowserMultiFileUpload` rebuilds every track as a
   *    fresh object each time it reports, so a plain replace threw away the
   *    region of every earlier track.
   * 2. **Keep one card per file.** That uploader re-sends its whole history, so
   *    a plain append gave seven cards for four files.
   *
   * Files are matched on name. Two different files with the same name collide,
   * which is what `getTrack` already assumed before this rewrite.
   */
  setTracks: (tracks: EditorTrack[]) => void;

  /** A non-reactive read, for event handlers. Components select instead. */
  getTrack: (fileName: string) => EditorTrack | undefined;

  setTrackRegion: (fileName: string, region: TrackRegion) => void;

  normalizeAudio: boolean;
  setNormalizeAudio: (normalize: boolean) => void;

  applyPostProcessing: boolean;
  setApplyPostProcessing: (apply: boolean) => void;

  trimSilence: boolean;
  setTrimSilence: (trim: boolean) => void;

  exportFileType: OutputFormat;
  setExportFileType: (fileType: OutputFormat) => void;

  processingLoading: boolean;
  setProcessingLoading: (loading: boolean) => void;

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
    const { normalizeAudio, applyPostProcessing, trimSilence, exportFileType } =
      get();

    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      {
        normalizeAudio,
        applyPostProcessing,
        trimSilence,
        exportFileType,
        [key]: value,
      }
    );
  };

  return {
    tracks: [],

    setTracks: (incoming: EditorTrack[]) => {
      const existing = get().tracks;
      const merged: EditorTrack[] = [];
      const seen = new Set<string>();

      for (const track of incoming) {
        const name = track.file.name;
        if (seen.has(name)) continue;
        seen.add(name);

        // Keep the object already in the store, so its region survives and its
        // card keeps the identity that stops it redrawing.
        merged.push(existing.find((t) => t.file.name === name) ?? track);
      }

      set({ tracks: merged });
    },

    getTrack: (fileName: string) =>
      get().tracks.find((track) => track.file.name === fileName),

    setTrackRegion: (fileName: string, region: TrackRegion) => {
      set({
        tracks: get().tracks.map((track) =>
          track.file.name === fileName ? { ...track, region } : track
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

    trimSilence: storedMasterDefaults.trimSilence,

    setTrimSilence: (trimSilence: boolean) => {
      persistMasterDefault("trimSilence", trimSilence);
      set({ trimSilence });
    },

    exportFileType: storedMasterDefaults.exportFileType,

    setExportFileType: (exportFileType: OutputFormat) => {
      persistMasterDefault("exportFileType", exportFileType);
      set({ exportFileType });
    },

    processingLoading: false,

    setProcessingLoading: (processingLoading: boolean) =>
      set({ processingLoading }),

    view:
      readPersisted(VIEW_STORAGE_KEY, VIEW_STORAGE_VERSION, isView) ??
      DEFAULT_VIEW,

    setView: (view: View) => {
      writePersisted(VIEW_STORAGE_KEY, VIEW_STORAGE_VERSION, view);
      set({ view });
    },
  };
});
