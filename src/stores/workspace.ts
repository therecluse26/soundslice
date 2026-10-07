import { create } from "zustand";

/**
 * Advanced view's **workspace**: which track is open, which side panels are
 * collapsed, and the small picture of each track the track list draws.
 *
 * None of this is project work. It never enters the command history, it is
 * never saved with a project, and undo never moves it — except that undo
 * **opens** the track it changed, the way it used to scroll to its card.
 *
 * The collapsed panels are a per-viewer convenience, so they live in
 * `localStorage`, and a browser that refuses storage simply starts expanded.
 */

/** A track's picture for the track list: peaks and the facts under its name. */
export type TrackOverview = {
  /** Absolute peaks, 0 to 1, evenly across the file. */
  peaks: number[];
  durationSec: number;
  channels: number;
};

export type InspectorTab = "sound" | "export";

type Collapsed = { tracks: boolean; inspector: boolean };

type WorkspaceState = {
  /** The open track's file name. `null` means "the first track". */
  activeTrack: string | null;
  collapsed: Collapsed;
  inspectorTab: InspectorTab;
  /** Where the open track's card draws its inspector. Set by the workspace. */
  inspectorElement: HTMLElement | null;
  overview: Record<string, TrackOverview>;

  setActiveTrack: (fileName: string) => void;
  toggleCollapsed: (panel: keyof Collapsed) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setInspectorElement: (element: HTMLElement | null) => void;
  setOverview: (fileName: string, overview: TrackOverview) => void;
};

const STORAGE_KEY = "soundslice:workspace";

function readCollapsed(): Collapsed {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      return { tracks: raw.tracks === true, inspector: raw.inspector === true };
    }
  } catch {
    // Blocked or damaged storage: start expanded.
  }
  return { tracks: false, inspector: false };
}

function writeCollapsed(collapsed: Collapsed): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch {
    // A preference that cannot be kept is still in force for this page.
  }
}

export const useWorkspace = create<WorkspaceState>()((set) => ({
  activeTrack: null,
  collapsed: readCollapsed(),
  inspectorTab: "sound",
  inspectorElement: null,
  overview: {},

  setActiveTrack: (fileName) => set({ activeTrack: fileName }),

  toggleCollapsed: (panel) =>
    set((state) => {
      const collapsed = { ...state.collapsed, [panel]: !state.collapsed[panel] };
      writeCollapsed(collapsed);
      return { collapsed };
    }),

  setInspectorTab: (inspectorTab) => set({ inspectorTab }),

  setInspectorElement: (inspectorElement) => set({ inspectorElement }),

  setOverview: (fileName, overview) =>
    set((state) => ({ overview: { ...state.overview, [fileName]: overview } })),
}));

/**
 * The open track: the stored one while it is still loaded, else the first.
 *
 * Removing the open track therefore opens the first one, and undoing that
 * removal opens it again — `scrollToTrack` sets it.
 */
export function openTrackName(
  fileNames: readonly string[],
  activeTrack: string | null
): string | undefined {
  if (activeTrack !== null && fileNames.includes(activeTrack)) return activeTrack;
  return fileNames[0];
}

/** Peaks for the track list, from wavesurfer's own export: one channel, abs. */
export function overviewPeaks(channels: number[][], points: number): number[] {
  const first = channels[0] ?? [];
  if (first.length === 0) return [];

  const out: number[] = [];
  const step = first.length / points;
  for (let index = 0; index < points; index++) {
    const from = Math.floor(index * step);
    const to = Math.max(from + 1, Math.floor((index + 1) * step));
    let peak = 0;
    for (let at = from; at < to && at < first.length; at++) {
      for (const channel of channels) {
        peak = Math.max(peak, Math.abs(channel[at] ?? 0));
      }
    }
    out.push(Math.min(1, peak));
  }
  return out;
}
