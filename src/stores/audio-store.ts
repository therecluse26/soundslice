import { create } from "zustand";
import { BitDepth, OutputFormat } from "@/lib/output-format";
// `import type`, not a plain import. `audio-service` pulls in JSZip, and this
// store is imported by every component. A value import here would put the zip
// library in front of the first waveform.
import type { ExportSettings, SliceProgress } from "@/lib/audio-service";
import { EditStack, Region, firstRegion } from "@/lib/edit-stack";
import {
  EMPTY_HISTORY,
  History,
  TrackSnapshot,
  changedFileNames,
  pushEntry,
  redoEntry,
  snapshotTrack,
  undoEntry,
} from "@/lib/history";
import {
  MEMORY_CEILING_BYTES,
  SizedFile,
  admit,
  formatBytes,
} from "@/lib/memory-ceiling";
// `import type`. A value import would pull `silence.ts` into the module every
// component already loads, and a Simple view user would download a tool they
// cannot reach. Standing rule 6, the same reasoning as the JSZip import above.
import type { SilenceSettings } from "@/lib/silence";
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
 * It is the edit stack's `Region`, which carries the region's own identity,
 * name, gain and fade edges beside its bounds.
 */
export type TrackRegion = Region;

export type EditorTrack = {
  file: File;

  /**
   * Every region on this track. **Many, and they may overlap.**
   *
   * An array, not a record. Order is derived from start time by
   * `orderedRegions`, because a drag can move a region past its neighbour at any
   * moment and an array that had to be resorted on write is one more thing to
   * forget. Identity is the region's own `id`, so nothing depends on position.
   *
   * **Zero is legal.** The track exports nothing and the card says so. Simple
   * view never sees zero — it keeps one — but every export path still has to
   * answer for it rather than skipping quietly, which is the shape of the defect
   * ticket 016 fixed.
   */
  regions: TrackRegion[];

  /**
   * The region the play button plays, by id.
   *
   * On the track, so it survives a view switch for free. `undefined` means the
   * first region by start time, which is also what Simple view draws — so a
   * track that has never been touched behaves exactly as it did before many
   * regions existed.
   */
  selectedRegionId?: string;

  /**
   * This track's own stack, when it has one.
   *
   * `undefined` means "inherit the master defaults", and `AudioService.stackFor`
   * turns those two switches into operations. A track only gets a stack of its
   * own once Advanced view can give it one.
   */
  stack?: EditStack;

  /**
   * The **Preview effects** switch for this track. On unless it says otherwise.
   *
   * Per track, because you judge it while listening to one track. Not persisted,
   * because it belongs to a file the browser cannot re-open — the same rule
   * regions follow.
   *
   * It never changes an exported file, so it is **not** counted on the Advanced
   * settings chip. The chip warns that an export is not what Simple view
   * describes, and this never is.
   */
  previewEffects?: boolean;
};

/** How a region edit is recorded on the command history. */
export type RegionEditOptions = {
  /** What the user did, in their words. Shown on the undo control. */
  label?: string;

  /**
   * Two edits sharing this key are one gesture, and undo reverses both.
   *
   * A slider dragged from 0 dB to −6 dB fires many times. One key — the region
   * and the property — makes them one entry, and letting go of the slider is
   * what ends the gesture, because the next key differs.
   */
  coalesceKey?: string;

  /** Skips the history entirely. For restores and for undo's own writes. */
  silent?: boolean;
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
   * Gives a track its regions, **only if it has none**, and records no history.
   *
   * The card calls this on mount for a track that has never had a region. That
   * is not a gesture — the user did not do it — so it must not land on the undo
   * stack, or the first Ctrl+Z of a session would delete a region nobody made.
   *
   * Ticket 017's rule lives here: a card restores what is stored and falls back
   * to the default only for a track with nothing.
   */
  ensureTrackRegions: (fileName: string, regions: TrackRegion[]) => void;

  /**
   * Replaces every region on a track, as one gesture.
   *
   * What split on silence calls, and what undo calls to put a list back.
   */
  setTrackRegions: (
    fileName: string,
    regions: TrackRegion[],
    options?: RegionEditOptions
  ) => void;

  /** Adds one region and selects it. */
  addTrackRegion: (
    fileName: string,
    region: TrackRegion,
    options?: RegionEditOptions
  ) => void;

  /**
   * Changes one region, keeping everything else it owns.
   *
   * A drag sends bounds; the list row sends a name, a gain or a fade. Merging
   * rather than replacing is why a dragged region keeps the gain the user set on
   * it — the rule `setTrackRegion` held before regions had identity.
   */
  updateTrackRegion: (
    fileName: string,
    id: string,
    patch: Partial<Omit<TrackRegion, "id">>,
    options?: RegionEditOptions
  ) => void;

  /** Removes one region. The track may end up with none, and that is legal. */
  removeTrackRegion: (
    fileName: string,
    id: string,
    options?: RegionEditOptions
  ) => void;

  /**
   * Selects a region, or clears the selection with `undefined`.
   *
   * **Not a gesture.** Selecting changes nothing about the audio or the file
   * list, so it is not on the undo stack. An undo that only moved a highlight
   * would look like a broken undo.
   */
  selectTrackRegion: (fileName: string, id: string | undefined) => void;

  /**
   * One command history for the whole project, per
   * [`designs/edit-stack.md`](../../.wayfinder/designs/edit-stack.md) §8.
   *
   * Not one per track: a gesture that touches every track at once cannot be
   * expressed by per-track histories, and "Clear Advanced settings" is exactly
   * that gesture.
   */
  history: History;

  /** Reverses the last gesture. Returns the tracks it changed, for scrolling. */
  undo: () => string[];

  /** Replays the last undone gesture. Returns the tracks it changed. */
  redo: () => string[];

  /**
   * The transient magnet, for every track at once.
   *
   * A magnet is a **mode**, the way grid snap is a mode, so it is one switch and
   * not one per track. Advanced view shows it in the Regions section.
   *
   * Not persisted. `MasterDefaults` holds what an export is made of; this
   * changes no exported file, only how a drag lands. The same reasoning keeps
   * **Preview effects** off the Advanced settings chip.
   */
  snapToTransients: boolean;
  setSnapToTransients: (snap: boolean) => void;

  /**
   * What split on silence is set to, for every track at once, or `null` for
   * **the defaults**.
   *
   * In the store rather than in the panel's own state, so switching to Simple
   * view and back does not throw the settings away. Standing rule 5: switching
   * views never loses work. Not persisted, for the same reason
   * `snapToTransients` is not — it changes no exported file by itself.
   *
   * `null` rather than `SILENCE_DEFAULTS`, and the reason is bundle size, not
   * taste. Naming the defaults here would import `silence.ts` into the module
   * every component already loads, and Simple view would download a tool it can
   * never reach. Standing rule 6. `outputSampleRate` uses `null` for "the
   * default" for the same kind of reason.
   */
  silenceSettings: SilenceSettings | null;
  setSilenceSettings: (settings: SilenceSettings) => void;

  /**
   * Gives this track a stack of its own, as one gesture.
   *
   * `undefined` gives the track back to the master defaults, which is what
   * "Reset to Simple" does. There is no in-between: a track either says what it
   * sounds like or it inherits, which is ticket 003's override model.
   *
   * On the command history, because a dragged EQ point is a gesture like a
   * dragged region edge, and Ctrl+Z must not skip past it to a region edit the
   * user made two minutes ago. `coalesceKey` makes one drag one entry, exactly
   * as it does for a region.
   */
  setTrackStack: (
    fileName: string,
    stack: EditStack | undefined,
    options?: RegionEditOptions
  ) => void;

  /** Turns this track's **Preview effects** switch on or off. */
  setTrackPreviewEffects: (fileName: string, effects: boolean) => void;

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

  /**
   * **Join** — one file per track instead of one per region. Advanced only.
   *
   * A master default beside the other export choices, because it decides the
   * shape of the whole export. See `MasterDefaults.joinRegions`.
   */
  joinRegions: boolean;
  setJoinRegions: (join: boolean) => void;

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
  /**
   * Applies one change to one track, and records it as a gesture.
   *
   * Every region action goes through here, so there is exactly one place that
   * knows how an edit becomes a history entry. `mutate` returns the track's new
   * regions and selection; this wraps them in a new track object and leaves
   * every other track's object identity alone — which is what stops the other
   * cards redrawing. Ticket 009's rule, unchanged.
   */
  const editTrack = (
    fileName: string,
    mutate: (
      track: EditorTrack
    ) => Partial<Pick<EditorTrack, "regions" | "selectedRegionId" | "stack">>,
    options: RegionEditOptions = {}
  ) => {
    const track = get().tracks.find((t) => t.file.name === fileName);
    if (!track) return;

    const before = snapshotTrack(
      fileName,
      track.regions,
      track.selectedRegionId,
      track.stack
    );

    // Whatever `mutate` did not name is carried over unchanged. Without this a
    // region drag would write `stack: undefined` and throw the track's EQ away,
    // because the snapshot the store applies is the whole of the track's
    // editable state and not a patch.
    const changed = mutate(track);
    const after = snapshotTrack(
      fileName,
      changed.regions ?? track.regions,
      "selectedRegionId" in changed ? changed.selectedRegionId : track.selectedRegionId,
      "stack" in changed ? changed.stack : track.stack
    );

    applyToTracks(
      [after],
      options.silent
        ? undefined
        : {
            label: options.label ?? "Edit regions",
            before: [before],
            after: [after],
            coalesceKey: options.coalesceKey,
          }
    );
  };

  /** Writes snapshots onto the tracks, and optionally records the gesture. */
  const applyToTracks = (
    snapshots: TrackSnapshot[],
    entry?: Parameters<typeof pushEntry>[1]
  ) => {
    const byName = new Map(snapshots.map((snap) => [snap.fileName, snap]));

    const tracks = get().tracks.map((track) => {
      const snap = byName.get(track.file.name);
      if (!snap) return track;

      return {
        ...track,
        regions: snap.regions,
        selectedRegionId: snap.selectedRegionId,
        stack: snap.stack,
      };
    });

    set(
      entry
        ? { tracks, history: pushEntry(get().history, entry) }
        : { tracks }
    );
  };

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
      joinRegions,
    } = get();

    // **Every key of `MasterDefaults`, twice.** The object below reaches
    // `writePersisted` as `unknown`, so a key forgotten here compiles cleanly
    // and writes a blob that `isMasterDefaults` rejects on the next load — the
    // user silently loses every setting and nothing points back to this line.
    // `master-defaults.test.ts` checks the round trip for exactly that reason.
    const stored: MasterDefaults = {
      normalizeAudio,
      applyPostProcessing,
      loudnessTargetLufs,
      exportFileType,
      bitDepth,
      outputSampleRate,
      joinRegions,
    };

    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      { ...stored, [key]: value }
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
          // `regions: []`, always. The uploader builds `{ file }` and casts, so
          // a fresh track arrives without the field. Normalising here means no
          // reader anywhere has to write `track.regions ?? []`, and a missing
          // array cannot reach the export path.
          ...fresh
            .filter((track) => allowed.has(track.file.name))
            .map((track) => ({ ...track, regions: track.regions ?? [] })),
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

    ensureTrackRegions: (fileName: string, regions: TrackRegion[]) => {
      const track = get().tracks.find((t) => t.file.name === fileName);
      if (!track || track.regions.length > 0) return;

      editTrack(fileName, () => ({ regions, selectedRegionId: regions[0]?.id }), {
        silent: true,
      });
    },

    setTrackRegions: (
      fileName: string,
      regions: TrackRegion[],
      options?: RegionEditOptions
    ) => {
      editTrack(
        fileName,
        (track) => ({
          regions,
          // Keep the selection if the region it names is still here. Split on
          // silence replaces every region, so it usually is not, and the first
          // of the new list is the sensible answer.
          selectedRegionId: regions.some((r) => r.id === track.selectedRegionId)
            ? track.selectedRegionId
            : regions[0]?.id,
        }),
        { label: "Replace regions", ...options }
      );
    },

    addTrackRegion: (
      fileName: string,
      region: TrackRegion,
      options?: RegionEditOptions
    ) => {
      editTrack(
        fileName,
        (track) => ({
          regions: [...track.regions, region],
          selectedRegionId: region.id,
        }),
        { label: "Add region", ...options }
      );
    },

    updateTrackRegion: (
      fileName: string,
      id: string,
      patch: Partial<Omit<TrackRegion, "id">>,
      options?: RegionEditOptions
    ) => {
      editTrack(
        fileName,
        (track) => ({
          regions: track.regions.map((region) =>
            region.id === id ? { ...region, ...patch } : region
          ),
          selectedRegionId: track.selectedRegionId,
        }),
        { label: "Edit region", ...options }
      );
    },

    removeTrackRegion: (
      fileName: string,
      id: string,
      options?: RegionEditOptions
    ) => {
      editTrack(
        fileName,
        (track) => {
          const regions = track.regions.filter((region) => region.id !== id);

          return {
            regions,
            selectedRegionId:
              track.selectedRegionId === id
                ? regions[0]?.id
                : track.selectedRegionId,
          };
        },
        { label: "Delete region", ...options }
      );
    },

    selectTrackRegion: (fileName: string, id: string | undefined) => {
      const track = get().tracks.find((t) => t.file.name === fileName);
      if (!track || track.selectedRegionId === id) return;

      set({
        tracks: get().tracks.map((t) =>
          t.file.name === fileName ? { ...t, selectedRegionId: id } : t
        ),
      });
    },

    history: EMPTY_HISTORY,

    undo: () => {
      const { history, entry } = undoEntry(get().history);
      if (!entry) return [];

      applyToTracks(entry.before);
      set({ history });

      return changedFileNames(entry);
    },

    redo: () => {
      const { history, entry } = redoEntry(get().history);
      if (!entry) return [];

      applyToTracks(entry.after);
      set({ history });

      return changedFileNames(entry);
    },

    snapToTransients: false,

    setSnapToTransients: (snapToTransients: boolean) => set({ snapToTransients }),

    silenceSettings: null,

    setSilenceSettings: (silenceSettings: SilenceSettings) =>
      set({ silenceSettings }),

    setTrackStack: (
      fileName: string,
      stack: EditStack | undefined,
      options: RegionEditOptions = {}
    ) => {
      editTrack(fileName, () => ({ stack }), {
        label: "Change sound",
        ...options,
      });
    },

    setTrackPreviewEffects: (fileName: string, previewEffects: boolean) => {
      set({
        tracks: get().tracks.map((track) =>
          track.file.name === fileName ? { ...track, previewEffects } : track
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

    joinRegions: storedMasterDefaults.joinRegions,

    setJoinRegions: (joinRegions: boolean) => {
      persistMasterDefault("joinRegions", joinRegions);
      set({ joinRegions });
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
 * The region this track's play button plays.
 *
 * The selected one, or the first by start time when nothing is selected. So a
 * track nobody has clicked behaves exactly as it did when a track held one
 * region — which is also the region Simple view draws and exports.
 *
 * `undefined` for a track with no regions. There is nothing to play.
 */
export function selectedRegion(
  track: EditorTrack | undefined
): TrackRegion | undefined {
  if (!track) return undefined;

  const chosen = track.regions.find(
    (region) => region.id === track.selectedRegionId
  );

  return chosen ?? firstRegion(track.regions);
}

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
    joinRegions,
  } = useAudioStore.getState();

  return {
    normalizeAudio,
    applyPostProcessing,
    loudnessTargetLufs,
    exportFileType,
    bitDepth,
    outputSampleRate: outputSampleRate ?? undefined,
    joinRegions,
  };
}


/**
 * The store, on `window`, in development builds only.
 *
 * `import.meta.env.DEV` is a compile-time constant, so this block is removed
 * from the production bundle rather than skipped at runtime — the same rule
 * `__previewElements` and `__renderCounts` follow.
 *
 * It exists because the only honest way to check a gesture is to drive it with
 * real pointer events and then read the numbers it actually wrote. Reading them
 * off the screen tests the formatting; reading them from here tests the edit.
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__audioStore = useAudioStore;
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
