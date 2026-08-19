import { Region } from "wavesurfer.js/dist/plugins/regions";
import { create } from "zustand";
import { OutputFormat } from "@/lib/audio-service";
import { MutableRefObject } from "react";
import { readPersisted, writePersisted } from "@/lib/persisted";
import {
  DEFAULT_VIEW,
  View,
  VIEW_STORAGE_KEY,
  VIEW_STORAGE_VERSION,
  isView,
} from "@/lib/view";

export type EditorTrack = {
  file: File;
  selectedRegion?: Region;
};

interface AudioState {
  tracks: MutableRefObject<EditorTrack[]>;

  setTracks: (tracks: EditorTrack[]) => void;
  addTrack: (track: EditorTrack) => void;
  getTrack: (fileName: string) => EditorTrack | undefined;
  setTrackSelectedRegion: (fileName: string, region: Region) => void;

  normalizeAudio: MutableRefObject<boolean>;
  setNormalizeAudio: (normalize: boolean) => void;

  applyPostProcessing: MutableRefObject<boolean>;
  setApplyPostProcessing: (apply: boolean) => void;

  trimSilence: MutableRefObject<boolean>;
  setTrimSilence: (trim: boolean) => void;

  exportFileType: MutableRefObject<OutputFormat>;
  setExportFileType: (fileType: OutputFormat) => void;

  rerender: number;
  triggerRerender: () => void;

  processingLoading: boolean;
  setProcessingLoading: (loading: boolean) => void;

  /**
   * Which set of controls is on screen. Real reactive state, not a ref, so a
   * component can subscribe to it alone.
   *
   * This is the *stored* view. What the user actually gets is the effective
   * view, which is Simple below 800 px. See `useEffectiveView`.
   */
  view: View;
  setView: (view: View) => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  tracks: { current: [] },

  setTracks: (tracks: EditorTrack[]) => {
    get().tracks.current = tracks;
  },

  addTrack: (track: EditorTrack) => {
    get().tracks.current = [...get().tracks.current, track];
  },

  getTrack: (fileName: string) =>
    get().tracks.current.find((f) => f.file.name === fileName),

  setTrackSelectedRegion: (fileName, region) => {
    get().tracks.current = get().tracks.current.map((track) => {
      if (track.file.name === fileName) {
        return { ...track, selectedRegion: region };
      }
      return track;
    });
  },

  normalizeAudio: { current: false },

  setNormalizeAudio: (normalize: boolean) => {
    get().normalizeAudio.current = normalize;
  },

  applyPostProcessing: { current: false },

  setApplyPostProcessing: (apply: boolean) => {
    get().applyPostProcessing.current = apply;
  },

  trimSilence: { current: false },

  setTrimSilence: (trim: boolean) => {
    get().trimSilence.current = trim;
  },

  exportFileType: { current: OutputFormat.WAV },

  setExportFileType: (fileType: OutputFormat) => {
    get().exportFileType.current = fileType;
  },

  rerender: 0,
  triggerRerender: () => set({ rerender: Math.random() }),

  processingLoading: false,

  setProcessingLoading: (loading: boolean) =>
    set({ processingLoading: loading }),

  view:
    readPersisted(VIEW_STORAGE_KEY, VIEW_STORAGE_VERSION, isView) ??
    DEFAULT_VIEW,

  setView: (view: View) => {
    writePersisted(VIEW_STORAGE_KEY, VIEW_STORAGE_VERSION, view);
    set({ view });
  },
}));
