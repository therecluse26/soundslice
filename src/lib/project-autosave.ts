/**
 * Autosave: every track's work, written to `localStorage` as it changes.
 * Ticket 038. The format and the rules are in `saved-project.ts`.
 *
 * ## When a track is written
 *
 * Only when its work differs from its **baseline** — what its card seeded or
 * what a saved project restored. A file dropped and never touched writes
 * nothing, so it never comes back with a "Restored" note for no reason.
 *
 * A seeded track whose work has gone back to its baseline — every edit undone,
 * or **Start fresh** pressed — has its record removed, so the next drop starts
 * clean as well.
 *
 * ## When it runs
 *
 * Half a second after the store stops changing. A region drag changes the store
 * sixty times a second, and serialising every track on every frame would be
 * the main-thread work standing rule 7 forbids. One write after the gesture is
 * enough: nothing is lost unless the tab dies inside that half second.
 */

import { EditorTrack, useAudioStore } from "@/stores/audio-store";
import { readPersisted, writePersisted } from "./persisted";
import {
  EMPTY_SAVED_PROJECTS,
  PROJECTS_STORAGE_KEY,
  PROJECTS_STORAGE_VERSION,
  SavedProjects,
  isSavedProjects,
  projectKey,
  rememberWork,
  workSignature,
} from "./saved-project";
import type { TrackWork } from "./track-work";

const QUIET_MS = 500;

/** Starts autosave. Returns the function that stops it. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTracks = useAudioStore.getState().tracks;

  const flush = () => {
    timer = null;
    saveTracks(useAudioStore.getState().tracks);
  };

  const unsubscribe = useAudioStore.subscribe((state) => {
    if (state.tracks === lastTracks) return;
    lastTracks = state.tracks;

    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, QUIET_MS);
  });

  // Leaving the page inside the quiet half second still saves.
  const onHide = () => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  };
  window.addEventListener("pagehide", onHide);

  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", onHide);
    if (timer) clearTimeout(timer);
  };
}

function workOf(track: EditorTrack): TrackWork {
  return {
    regions: track.regions,
    selectedRegionId: track.selectedRegionId,
    stack: track.stack,
    exportOverrides: track.exportOverrides,
    join: track.join,
  };
}

function saveTracks(tracks: EditorTrack[]): void {
  let saved: SavedProjects =
    readPersisted(PROJECTS_STORAGE_KEY, PROJECTS_STORAGE_VERSION, isSavedProjects) ??
    EMPTY_SAVED_PROJECTS;

  const before = saved;
  const now = Date.now();

  for (const track of tracks) {
    // Not seeded yet: the card has not given it its first region.
    if (track.baseline === undefined) continue;

    const key = projectKey(track.file);
    const work = workOf(track);
    const untouched = workSignature(work) === track.baseline;

    if (!untouched) {
      saved = rememberWork(saved, key, work, now);
    } else if (!track.restored && saved.entries[key]) {
      const entries = { ...saved.entries };
      delete entries[key];
      saved = { entries };
    }
  }

  if (saved !== before) {
    writePersisted(PROJECTS_STORAGE_KEY, PROJECTS_STORAGE_VERSION, saved);
  }
}
