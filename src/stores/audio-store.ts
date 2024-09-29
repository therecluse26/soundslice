import { Region } from "wavesurfer.js/dist/plugins/regions";
import { create } from "zustand";
import { OutputFormat } from "@/lib/audio-service";

export type EditorTrack = {
  file: File;
  selectedRegion?: Region;
};

interface AudioState {
  tracks: EditorTrack[];
  setFiles: (tracks: EditorTrack[]) => void;
  addFile: (track: EditorTrack) => void;
  getTrack: (fileName: string) => EditorTrack | undefined;
  updateFile: (track: EditorTrack) => void;
  compressFiles: boolean;
  setCompressFiles: (compress: boolean) => void;
  normalizeAudio: boolean;
  setNormalizeAudio: (normalize: boolean) => void;
  exportFileType: OutputFormat;
  setExportFileType: (fileType: OutputFormat) => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  tracks: [],
  setFiles: (tracks: EditorTrack[]) => set({ tracks: tracks }),
  addFile: (tracks: EditorTrack) =>
    set((state) => ({ tracks: [...state.tracks, tracks] })),
  getTrack: (fileName: string) =>
    get().tracks.find((f) => f.file.name === fileName),
  updateFile: (track: EditorTrack) =>
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.file.name === track.file.name ? track : t
      ),
    })),

  compressFiles: false,
  setCompressFiles: (compress) => set({ compressFiles: compress }),

  normalizeAudio: false,
  setNormalizeAudio: (normalize) => set({ normalizeAudio: normalize }),

  exportFileType: OutputFormat.WAV,
  setExportFileType: (fileType) => set({ exportFileType: fileType }),
}));
