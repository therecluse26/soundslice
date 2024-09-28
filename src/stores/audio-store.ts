import { Region } from 'wavesurfer.js/dist/plugins/regions';
import { create } from 'zustand'

export type AudioFile = {
    file: File;
    selectedRegion?: Region;
};

export enum FileType {
    WAV = 'wav',
    MP3 = 'mp3',
    FLAC = 'flac',
}

interface AudioState {
    files: AudioFile[];
    setFiles: (files: AudioFile[]) => void;
    addFile: (file: AudioFile) => void;
    removeFile: (file: AudioFile) => void;
    getFile: (fileName: string) => AudioFile | undefined;
    updateFile: (file: AudioFile) => void;
    compressFiles: boolean;
    setCompressFiles: (compress: boolean) => void;
    normalizeAudio: boolean;
    setNormalizeAudio: (normalize: boolean) => void;
    exportFileType: FileType;
    setExportFileType: (fileType: FileType) => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
    files: [],
    setFiles: (files: AudioFile[]) => set({ files }),
    addFile: (file: AudioFile) => set((state) => ({ files: [...state.files, file] })),
    removeFile: (file: AudioFile) => set((state) => ({ files: state.files.filter((f) => f.file.name !== file.file.name) })),
    getFile: (fileName: string) =>  get().files.find((f) => f.file.name === fileName),
    updateFile: (file: AudioFile) => set((state) => ({
        files: state.files.map((f) => f.file.name === file.file.name ? file : f)
    })),

    compressFiles: false,
    setCompressFiles: (compress) => set({ compressFiles: compress }),

    normalizeAudio: false,
    setNormalizeAudio: (normalize) => set({ normalizeAudio: normalize }),

    exportFileType: FileType.WAV,
    setExportFileType: (fileType) => set({ exportFileType: fileType }),
}))