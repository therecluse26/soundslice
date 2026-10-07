import { create } from "zustand";
import { BitDepth, OutputFormat } from "@/lib/output-format";
// `import type`, not a plain import. `audio-service` pulls in JSZip, and this
// store is imported by every component. A value import here would put the zip
// library in front of the first waveform.
import type { ExportSettings, SliceProgress } from "@/lib/audio-service";
import {
  EditStack,
  Region,
  firstRegion,
  simpleStack,
} from "@/lib/edit-stack";
import {
  EMPTY_HISTORY,
  History,
  HistoryEntry,
  TrackSnapshot,
  changedFileNames,
  filesHeldByHistory,
  pushEntry,
  redoEntry,
  snapshotWork,
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
  JoinMode,
  MASTER_DEFAULTS_STORAGE_KEY,
  MASTER_DEFAULTS_STORAGE_VERSION,
  MasterDefaults,
  isMasterDefaults,
} from "@/lib/master-defaults";
import {
  ExportOverrides,
  JoinLayout,
  TrackWork,
  copyWork,
} from "@/lib/track-work";
// `import type` for the parser's shape, and the signature from its own small
// module: the parser, the guards and the project file stay out of Simple
// view's bundle until a card asks for them. Standing rule 6.
import type { ProjectTrack } from "@/lib/saved-project";
import { workSignature } from "@/lib/work-signature";
import {
  DEFAULT_REGION_TOOL_PREFS,
  REGION_TOOLS_STORAGE_KEY,
  REGION_TOOLS_STORAGE_VERSION,
  RegionToolPrefs,
  TransientSplitSettings,
  isRegionToolPrefs,
} from "@/lib/region-tool-prefs";

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

/**
 * One loaded file, and the work done on it.
 *
 * The work — regions, the stack, the export choices this track overrides, the
 * join layout — is a `TrackWork`, defined once in
 * [`track-work.ts`](../lib/track-work.ts), because the command history and saved
 * projects both have to carry all of it. See that file for each field.
 *
 * **`regions` may hold many, and they may overlap. Zero is legal**: the track
 * exports nothing and the card says so. `selectedRegionId` is the region the
 * play button plays; `undefined` means the first by start time. `stack`
 * `undefined` means "inherit the master defaults".
 */
export type EditorTrack = TrackWork & {
  file: File;

  /**
   * The **Preview effects** switch for this track. On unless it says otherwise.
   *
   * Per track, because you judge it while listening to one track. **Not work**:
   * it changes no exported file, so it is not on the history, not in a saved
   * project, and not counted on the Advanced settings chip.
   */
  previewEffects?: boolean;

  /**
   * The work this track was **given** — the region its card seeded, or the
   * work a saved project restored — as a `workSignature`. Not work itself.
   *
   * Autosave compares against it. A track whose work still matches was not
   * touched, and is not remembered; one that differs is. Without it every file
   * ever dropped would come back "Restored" holding nothing but the default
   * region. Ticket 038.
   */
  baseline?: string;

  /** True when this track's work came back from a saved project. */
  restored?: boolean;
};

/** How an edit is recorded on the command history. */
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
   * Real state, one entry per loaded file, in the order the cards are drawn.
   *
   * Updated immutably, and only the changed track gets a new object. Every
   * other track keeps its identity, so a card that did not change does not
   * redraw. That is this store's whole job.
   */
  tracks: EditorTrack[];

  /**
   * Loads files as new tracks, **as one gesture**.
   *
   * Three things it must do:
   *
   * 1. **Keep one card per file.** A file already loaded is skipped. Files are
   *    matched on name, which is what `getTrack` has always assumed.
   * 2. **Hold the memory ceiling.** A loaded track costs its whole encoded file
   *    until its card unmounts, and so does a file the undo history is keeping
   *    for a removed track. A drop that would cross 1 GB is refused, and
   *    nothing already loaded is touched.
   * 3. **Be undoable.** Ctrl+Z after a drop takes the new cards away again.
   *
   * It replaces `setTracks`, which took the uploader's whole history every time
   * and merged it. That shape is why a removed track could never stay removed:
   * the next drop re-sent it.
   */
  addFiles: (files: File[]) => void;

  /**
   * Takes a track off the page, as one gesture. Undo puts it back with every
   * region, setting and override it had.
   *
   * The history keeps the `File`, because the browser cannot re-open it for us.
   * The memory ceiling counts it for as long as it is kept.
   */
  removeTrack: (fileName: string) => void;

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
   * Gives a track the work autosave kept for its file, **only if it has no
   * regions**, and records no history. Ticket 038.
   *
   * The card calls this in place of `ensureTrackRegions` when it finds a saved
   * record. Not a gesture, for the same reason seeding is not: the user did not
   * do it, and the first Ctrl+Z of a session must not take it away.
   */
  restoreTrack: (fileName: string, work: TrackWork) => void;

  /**
   * Replaces every region on a track, as one gesture.
   *
   * What split on silence and split at transients call.
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
   * A drag sends bounds; the overlay sends a name, a gain or a fade. Merging
   * rather than replacing is why a dragged region keeps the gain the user set on
   * it.
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
   * Not one per track: "Clear Advanced settings" and "Copy to all tracks" touch
   * every track at once, and per-track histories could not express either.
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
   * not one per track.
   *
   * Persisted since ticket 032, with the other region tool settings, as a
   * preference and not as project work: it changes how a drag lands, never what
   * an export holds. See `region-tool-prefs.ts`.
   */
  snapToTransients: boolean;
  setSnapToTransients: (snap: boolean) => void;

  /**
   * What split on silence is set to, for every track at once, or `null` for
   * **the defaults**.
   *
   * `null` rather than `SILENCE_DEFAULTS`, and the reason is bundle size, not
   * taste. Naming the defaults here would import `silence.ts` into the module
   * every component already loads, and Simple view would download a tool it can
   * never reach. Standing rule 6.
   */
  silenceSettings: SilenceSettings | null;
  setSilenceSettings: (settings: SilenceSettings) => void;

  /** What split at transients is set to, or `null` for the defaults. */
  transientSplitSettings: TransientSplitSettings | null;
  setTransientSplitSettings: (settings: TransientSplitSettings) => void;

  /**
   * Gives this track a stack of its own, as one gesture.
   *
   * `undefined` gives the track back to the master defaults, which is what
   * "Reset" does. There is no in-between: a track either says what it sounds
   * like or it inherits, which is ticket 003's override model.
   */
  setTrackStack: (
    fileName: string,
    stack: EditStack | undefined,
    options?: RegionEditOptions
  ) => void;

  /**
   * Sets the export choices this track makes for itself, as one gesture.
   *
   * `undefined`, or an object with no keys set, gives every choice back to the
   * master. Ticket 033.
   */
  setTrackExportOverrides: (
    fileName: string,
    overrides: ExportOverrides | undefined,
    options?: RegionEditOptions
  ) => void;

  /** Sets how a join lays this track's regions out, as one gesture. */
  setTrackJoinLayout: (
    fileName: string,
    layout: JoinLayout | undefined,
    options?: RegionEditOptions
  ) => void;

  /**
   * Writes one track's sound onto every other track, as **one** gesture.
   *
   * Ticket 003 settled the mechanism and ticket 031 the contents: the source's
   * **effective** stack becomes every other track's own, so an inherited chain
   * is turned into an override, and Reset gives any one track back. **Noise
   * reduction is not copied** — a noise profile is measured from one recording,
   * and subtracting one room's hiss from another's would be wrong in a way
   * nobody could hear coming. A track that already has its own noise reduction
   * keeps it.
   */
  copySoundToAllTracks: (fromFileName: string) => void;

  /**
   * Writes one track's export overrides onto every other track, as one gesture.
   *
   * The overrides exactly as they are: an inherited choice stays inherited. Ticket
   * 033 says why that differs from the sound.
   */
  copyExportToAllTracks: (fromFileName: string) => void;

  /**
   * Puts the whole project back to what Simple view can describe, as **one**
   * gesture across every track and the master defaults.
   *
   * The gesture the edit stack design used to argue for one history instead of
   * one per track (§8). Built by ticket 031. Everything the Advanced settings
   * chip counts goes, so the chip reads zero afterwards:
   *
   * - every track's own stack, export overrides and join layout
   * - every region but the first by start time, and any time and pitch on it
   * - the master export choices Simple view cannot offer, and the loudness target
   *
   * Ctrl+Z puts all of it back.
   */
  clearAdvancedSettings: () => void;

  /**
   * Throws away a restored project's work and starts this track again from one
   * region, as one gesture. Ctrl+Z brings the restored work back. Ticket 038.
   */
  startFresh: (fileName: string, region: TrackRegion) => void;

  /**
   * Applies an opened project file to the tracks on the page, as **one**
   * gesture. A track is matched by name and size, then by name alone. Returns
   * the file names it found no track for, so the caller can say which.
   */
  openProject: (tracks: ProjectTrack[]) => { applied: string[]; missing: string[] };

  /** Turns this track's **Preview effects** switch on or off. Not a gesture. */
  setTrackPreviewEffects: (fileName: string, effects: boolean) => void;

  /**
   * Why the last drop was refused, or `null`.
   *
   * The memory ceiling refuses, it never evicts. This is the reason the user is
   * shown, and it is cleared by the next drop that succeeds.
   */
  refusal: string | null;
  clearRefusal: () => void;

  /*
   * The master defaults. **Every setter is a gesture on the history** since
   * ticket 030. One slider drag is one entry: pass a `coalesceKey` and change it
   * when the pointer is let go, the same way the signal chain does.
   */

  normalizeAudio: boolean;
  setNormalizeAudio: (normalize: boolean) => void;

  applyPostProcessing: boolean;
  setApplyPostProcessing: (apply: boolean) => void;

  /**
   * What "Normalize Levels? Yes" aims at, in LUFS. Advanced view only.
   *
   * Simple view gains no control for it — that is ticket 010's rule — but it
   * still reads this value, so an Advanced user's choice applies in both views.
   */
  loudnessTargetLufs: number;
  setLoudnessTargetLufs: (target: number, options?: RegionEditOptions) => void;

  exportFileType: OutputFormat;
  setExportFileType: (fileType: OutputFormat) => void;

  /** Bits per stored sample, for WAV and FLAC. Advanced view only. */
  bitDepth: BitDepth;
  setBitDepth: (bitDepth: BitDepth) => void;

  /** The rate to export at, in hertz, or `null` for the file's own rate. */
  outputSampleRate: number | null;
  setOutputSampleRate: (sampleRate: number | null) => void;

  /** **Join** — how many files an export writes. See `MasterDefaults.joinMode`. */
  joinMode: JoinMode;
  setJoinMode: (mode: JoinMode) => void;

  processingLoading: boolean;
  setProcessingLoading: (loading: boolean) => void;

  /**
   * Where the running export has got to, or `null` when nothing is running.
   *
   * Standing rule 7: anything over 300 ms shows progress.
   */
  sliceProgress: SliceProgress | null;
  setSliceProgress: (progress: SliceProgress | null) => void;

  /**
   * The running batch export's off switch, or `null` when none is running.
   *
   * An `AbortController` and not a flag, because the engine already reads one
   * shape — `isCancelled` between render passes — and an encode in flight has to
   * be told as well. `cancelExport` aborts it; the export notices at its next
   * pass boundary or encode chunk, downloads nothing, and the overlay closes.
   * Ticket 035.
   */
  exportController: AbortController | null;
  setExportController: (controller: AbortController | null) => void;
  cancelExport: () => void;

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

const storedRegionTools: RegionToolPrefs =
  readPersisted(
    REGION_TOOLS_STORAGE_KEY,
    REGION_TOOLS_STORAGE_VERSION,
    isRegionToolPrefs
  ) ?? DEFAULT_REGION_TOOL_PREFS;

/** What each master default is called on the undo button. */
const MASTER_LABEL: Record<keyof MasterDefaults, string> = {
  normalizeAudio: "Normalize levels",
  applyPostProcessing: "Post processing",
  loudnessTargetLufs: "Loudness target",
  exportFileType: "Output format",
  bitDepth: "Bit depth",
  outputSampleRate: "Sample rate",
  joinMode: "Join",
};

export const useAudioStore = create<AudioState>((set, get) => {
  /** The work a track holds right now, as a snapshot for the history. */
  const snapshotOf = (track: EditorTrack): TrackSnapshot =>
    snapshotWork(track.file.name, track);

  /**
   * Applies one change to one track, and records it as a gesture.
   *
   * Every track edit goes through here, so there is exactly one place that knows
   * how an edit becomes a history entry. `mutate` returns the parts of the work
   * that changed; everything it does not name is carried over unchanged. Without
   * that a region drag would write `stack: undefined` and throw the track's EQ
   * away, because the snapshot the store applies is the whole of the track's
   * work and not a patch.
   */
  const editTrack = (
    fileName: string,
    mutate: (track: EditorTrack) => Partial<TrackWork>,
    options: RegionEditOptions = {}
  ) => {
    const track = get().tracks.find((t) => t.file.name === fileName);
    if (!track) return;

    const before = snapshotOf(track);
    const after = snapshotWork(fileName, { ...track, ...mutate(track) });

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

  /** Applies the same kind of change to every track, as one gesture. */
  const editEveryTrack = (
    label: string,
    mutate: (track: EditorTrack) => Partial<TrackWork> | null,
    master?: Partial<MasterDefaults>
  ) => {
    const before: TrackSnapshot[] = [];
    const after: TrackSnapshot[] = [];

    for (const track of get().tracks) {
      const patch = mutate(track);
      if (!patch) continue;
      before.push(snapshotOf(track));
      after.push(snapshotWork(track.file.name, { ...track, ...patch }));
    }

    const entry: HistoryEntry = { label, before, after };

    if (master) {
      const was = currentMaster();
      const now = { ...was, ...master };
      entry.master = { before: was, after: now };
      applyMaster(now);
    }

    applyToTracks(after, entry);
  };

  /**
   * Writes snapshots onto the tracks, and optionally records the gesture.
   *
   * A snapshot is the whole of a track's work, so every work field is written —
   * the ones a gesture did not touch are written back as they were.
   */
  const applyToTracks = (snapshots: TrackSnapshot[], entry?: HistoryEntry) => {
    const byName = new Map(snapshots.map((snap) => [snap.fileName, snap]));

    const tracks = get().tracks.map((track) => {
      const snap = byName.get(track.file.name);
      if (!snap) return track;

      const { fileName, ...work } = snap;
      void fileName;
      return { ...track, ...copyWork(work) };
    });

    set(
      entry
        ? { tracks, history: pushEntry(get().history, entry) }
        : { tracks }
    );
  };

  /**
   * Puts the track list back to exactly these files, in this order.
   *
   * A file already on screen keeps its track object — and so its card, its
   * waveform and its decoded peaks. A file that is not on screen becomes a track
   * again, carrying the work the entry's snapshot holds for it.
   */
  const applyFileList = (files: File[], snapshots: TrackSnapshot[]) => {
    const current = get().tracks;
    const byName = new Map(snapshots.map((snap) => [snap.fileName, snap]));

    set({
      tracks: files.map((file) => {
        const existing = current.find((track) => track.file === file);
        if (existing) return existing;

        const snap = byName.get(file.name);
        if (!snap) return { file, regions: [] };

        const { fileName, ...work } = snap;
        void fileName;
        // A track coming back by undo was saved as it left. Its baseline is
        // that work, so autosave writes it again only once it changes.
        return { file, ...copyWork(work), baseline: workSignature(work) };
      }),
    });
  };

  /** Reverses or replays one half of an entry. */
  const applyHalf = (entry: HistoryEntry, half: "before" | "after") => {
    if (entry.files) applyFileList(entry.files[half], entry[half]);
    if (entry.master) applyMaster(entry.master[half]);
    applyToTracks(entry[half]);
  };

  /** The master defaults as they stand, as one object. */
  const currentMaster = (): MasterDefaults => {
    const state = get();
    // **Every key of `MasterDefaults`.** This object reaches `writePersisted`
    // as `unknown`, so a key forgotten here compiles cleanly and writes a blob
    // that `isMasterDefaults` rejects on the next load — the user silently loses
    // every setting and nothing points back to this line.
    // `master-defaults.test.ts` checks the round trip for exactly that reason.
    return {
      normalizeAudio: state.normalizeAudio,
      applyPostProcessing: state.applyPostProcessing,
      loudnessTargetLufs: state.loudnessTargetLufs,
      exportFileType: state.exportFileType,
      bitDepth: state.bitDepth,
      outputSampleRate: state.outputSampleRate,
      joinMode: state.joinMode,
    };
  };

  /** Sets every master default at once, and persists them. No history. */
  const applyMaster = (master: MasterDefaults) => {
    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      master
    );
    set({ ...master });
  };

  /** Changes one master default, as a gesture. */
  const setMaster = <K extends keyof MasterDefaults>(
    key: K,
    value: MasterDefaults[K],
    options: RegionEditOptions = {}
  ) => {
    const before = currentMaster();
    if (before[key] === value) return;

    const after = { ...before, [key]: value };
    applyMaster(after);

    if (options.silent) return;

    set({
      history: pushEntry(get().history, {
        label: options.label ?? MASTER_LABEL[key],
        before: [],
        after: [],
        master: { before, after },
        coalesceKey: options.coalesceKey,
      }),
    });
  };

  const persistRegionTools = () => {
    const { snapToTransients, silenceSettings, transientSplitSettings } = get();
    const prefs: RegionToolPrefs = {
      snapToTransients,
      silenceSettings,
      transientSplitSettings,
    };
    writePersisted(REGION_TOOLS_STORAGE_KEY, REGION_TOOLS_STORAGE_VERSION, prefs);
  };

  return {
    tracks: [],
    refusal: null,

    addFiles: (files: File[]) => {
      const existing = get().tracks;
      const seen = new Set(existing.map((track) => track.file.name));
      const fresh: File[] = [];

      for (const file of files) {
        if (seen.has(file.name)) continue;
        seen.add(file.name);
        fresh.push(file);
      }

      if (fresh.length === 0) return;

      const onScreen = existing.map((track) => track.file);
      const keptForUndo = filesHeldByHistory(get().history, onScreen);
      const { accepted, refused } = admit([...onScreen, ...keptForUndo], fresh);

      const refusal = refused.length
        ? refusalMessage(refused, [...onScreen, ...accepted], keptForUndo)
        : null;

      if (accepted.length === 0) {
        set({ refusal });
        return;
      }

      const after = [...onScreen, ...accepted];

      // `regions: []`, always, so no reader anywhere has to write
      // `track.regions ?? []`. The card seeds the first region once it knows
      // the duration — or restores the work autosave kept for this file.
      const added: EditorTrack[] = accepted.map((file) => ({ file, regions: [] }));

      set({
        tracks: [...existing, ...added],
        refusal,
        history: pushEntry(get().history, {
          label: accepted.length === 1 ? "Add file" : `Add ${accepted.length} files`,
          before: [],
          after: [],
          files: { before: onScreen, after },
        }),
      });
    },

    removeTrack: (fileName: string) => {
      const existing = get().tracks;
      const track = existing.find((t) => t.file.name === fileName);
      if (!track) return;

      const before = existing.map((t) => t.file);
      const after = before.filter((file) => file !== track.file);

      set({
        tracks: existing.filter((t) => t !== track),
        history: pushEntry(get().history, {
          label: "Remove track",
          // The removed track's work rides on the entry, so undo brings back
          // its regions, its chain and its overrides — not a fresh card.
          before: [snapshotOf(track)],
          after: [],
          files: { before, after },
        }),
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

      // What autosave compares against. See `EditorTrack.baseline`.
      set({
        tracks: get().tracks.map((t) =>
          t.file.name === fileName
            ? { ...t, baseline: workSignature({ regions }) }
            : t
        ),
      });
    },

    restoreTrack: (fileName: string, work: TrackWork) => {
      const track = get().tracks.find((t) => t.file.name === fileName);
      if (!track || track.regions.length > 0) return;

      set({
        tracks: get().tracks.map((t) =>
          t === track
            ? {
                ...t,
                ...copyWork(work),
                baseline: workSignature(work),
                restored: true,
              }
            : t
        ),
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
          // Keep the selection if the region it names is still here. A split
          // replaces every region, so it usually is not, and the first of the
          // new list is the sensible answer.
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

      applyHalf(entry, "before");
      set({ history });

      return changedFileNames(entry);
    },

    redo: () => {
      const { history, entry } = redoEntry(get().history);
      if (!entry) return [];

      applyHalf(entry, "after");
      set({ history });

      return changedFileNames(entry);
    },

    snapToTransients: storedRegionTools.snapToTransients,

    setSnapToTransients: (snapToTransients: boolean) => {
      set({ snapToTransients });
      persistRegionTools();
    },

    silenceSettings: storedRegionTools.silenceSettings,

    setSilenceSettings: (silenceSettings: SilenceSettings) => {
      set({ silenceSettings });
      persistRegionTools();
    },

    transientSplitSettings: storedRegionTools.transientSplitSettings,

    setTransientSplitSettings: (transientSplitSettings: TransientSplitSettings) => {
      set({ transientSplitSettings });
      persistRegionTools();
    },

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

    setTrackExportOverrides: (
      fileName: string,
      overrides: ExportOverrides | undefined,
      options: RegionEditOptions = {}
    ) => {
      editTrack(fileName, () => ({ exportOverrides: tidyOverrides(overrides) }), {
        label: "Change export",
        ...options,
      });
    },

    setTrackJoinLayout: (
      fileName: string,
      layout: JoinLayout | undefined,
      options: RegionEditOptions = {}
    ) => {
      editTrack(fileName, () => ({ join: layout }), {
        label: "Change join",
        ...options,
      });
    },

    copySoundToAllTracks: (fromFileName: string) => {
      const source = get().tracks.find((t) => t.file.name === fromFileName);
      if (!source) return;

      const master = currentMaster();
      const sound = (source.stack ?? simpleStack(master)).filter(
        (operation) => operation.op !== "noiseReduction"
      );

      editEveryTrack("Copy sound to all tracks", (track) => {
        if (track === source) return null;

        // A track's own noise reduction stays where it is. Its profile was
        // measured from that track's own recording.
        const ownNoise = (track.stack ?? []).filter(
          (operation) => operation.op === "noiseReduction"
        );

        return { stack: [...ownNoise, ...sound] };
      });
    },

    copyExportToAllTracks: (fromFileName: string) => {
      const source = get().tracks.find((t) => t.file.name === fromFileName);
      if (!source) return;

      editEveryTrack("Copy export to all tracks", (track) =>
        track === source
          ? null
          : { exportOverrides: tidyOverrides(source.exportOverrides) }
      );
    },

    clearAdvancedSettings: () => {
      const master = currentMaster();

      editEveryTrack(
        "Clear Advanced settings",
        (track) => {
          const first = firstRegion(track.regions);
          const kept = first ? [{ ...first, stretch: undefined }] : [];

          return {
            regions: kept,
            selectedRegionId: kept[0]?.id,
            stack: undefined,
            exportOverrides: undefined,
            join: undefined,
          };
        },
        {
          // WAV and MP3 are the two formats Simple view offers. Anything else
          // falls back to WAV, which is the default every new user gets.
          exportFileType:
            master.exportFileType === OutputFormat.MP3
              ? OutputFormat.MP3
              : OutputFormat.WAV,
          bitDepth: DEFAULT_MASTER_DEFAULTS.bitDepth,
          outputSampleRate: DEFAULT_MASTER_DEFAULTS.outputSampleRate,
          joinMode: DEFAULT_MASTER_DEFAULTS.joinMode,
          loudnessTargetLufs: DEFAULT_MASTER_DEFAULTS.loudnessTargetLufs,
        }
      );
    },

    startFresh: (fileName: string, region: TrackRegion) => {
      editTrack(
        fileName,
        () => ({
          regions: [region],
          selectedRegionId: region.id,
          stack: undefined,
          exportOverrides: undefined,
          join: undefined,
        }),
        { label: "Start fresh" }
      );

      set({
        tracks: get().tracks.map((t) =>
          t.file.name === fileName
            ? {
                ...t,
                baseline: workSignature({ regions: [region] }),
                restored: false,
              }
            : t
        ),
      });
    },

    openProject: (project: ProjectTrack[]) => {
      const tracks = get().tracks;
      const applied: string[] = [];
      const missing: string[] = [];
      const matched = new Map<EditorTrack, TrackWork>();

      for (const saved of project) {
        const track =
          tracks.find(
            (t) => t.file.name === saved.fileName && t.file.size === saved.size
          ) ?? tracks.find((t) => t.file.name === saved.fileName);

        if (!track || matched.has(track)) {
          missing.push(saved.fileName);
          continue;
        }
        matched.set(track, saved.work);
        applied.push(track.file.name);
      }

      if (matched.size > 0) {
        editEveryTrack("Open project", (track) => matched.get(track) ?? null);
      }

      return { applied, missing };
    },

    setTrackPreviewEffects: (fileName: string, previewEffects: boolean) => {
      set({
        tracks: get().tracks.map((track) =>
          track.file.name === fileName ? { ...track, previewEffects } : track
        ),
      });
    },

    normalizeAudio: storedMasterDefaults.normalizeAudio,
    setNormalizeAudio: (normalizeAudio: boolean) =>
      setMaster("normalizeAudio", normalizeAudio),

    applyPostProcessing: storedMasterDefaults.applyPostProcessing,
    setApplyPostProcessing: (applyPostProcessing: boolean) =>
      setMaster("applyPostProcessing", applyPostProcessing),

    loudnessTargetLufs: storedMasterDefaults.loudnessTargetLufs,
    setLoudnessTargetLufs: (loudnessTargetLufs: number, options?: RegionEditOptions) =>
      setMaster("loudnessTargetLufs", loudnessTargetLufs, options),

    exportFileType: storedMasterDefaults.exportFileType,
    setExportFileType: (exportFileType: OutputFormat) =>
      setMaster("exportFileType", exportFileType),

    bitDepth: storedMasterDefaults.bitDepth,
    setBitDepth: (bitDepth: BitDepth) => setMaster("bitDepth", bitDepth),

    outputSampleRate: storedMasterDefaults.outputSampleRate,
    setOutputSampleRate: (outputSampleRate: number | null) =>
      setMaster("outputSampleRate", outputSampleRate),

    joinMode: storedMasterDefaults.joinMode,
    setJoinMode: (joinMode: JoinMode) => setMaster("joinMode", joinMode),

    processingLoading: false,

    setProcessingLoading: (processingLoading: boolean) =>
      set({ processingLoading }),

    sliceProgress: null,

    setSliceProgress: (sliceProgress: SliceProgress | null) =>
      set({ sliceProgress }),

    exportController: null,

    setExportController: (exportController: AbortController | null) =>
      set({ exportController }),

    cancelExport: () => get().exportController?.abort(),

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
 * Overrides with nothing set are no overrides at all.
 *
 * `{}` and `undefined` mean the same thing — "inherit everything" — and the
 * history must not see a change between them, or resetting the last override
 * would push an entry that undoes to the same picture.
 */
function tidyOverrides(
  overrides: ExportOverrides | undefined
): ExportOverrides | undefined {
  if (!overrides) return undefined;

  const kept: ExportOverrides = {};
  if (overrides.exportFileType !== undefined) {
    kept.exportFileType = overrides.exportFileType;
  }
  if (overrides.bitDepth !== undefined) kept.bitDepth = overrides.bitDepth;
  if (overrides.outputSampleRate !== undefined) {
    kept.outputSampleRate = overrides.outputSampleRate;
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

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
 * does not redraw when a master default changes. A track's own export overrides
 * are laid on top of these by `AudioService.settingsFor`, never here.
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
    joinMode,
  } = useAudioStore.getState();

  return {
    normalizeAudio,
    applyPostProcessing,
    loudnessTargetLufs,
    exportFileType,
    bitDepth,
    outputSampleRate: outputSampleRate ?? undefined,
    joinMode,
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

function refusalMessage(
  refused: SizedFile[],
  kept: SizedFile[],
  keptForUndo: SizedFile[]
): string {
  const held = [...kept, ...keptForUndo].reduce((sum, file) => sum + file.size, 0);
  const forUndo = keptForUndo.reduce((sum, file) => sum + file.size, 0);
  const names = refused.map((file) => file.name).join(", ");

  return (
    `${refused.length === 1 ? "This file was" : "These files were"} not ` +
    `loaded: ${names}. SoundSlice holds ` +
    `${formatBytes(MEMORY_CEILING_BYTES)} of audio at once and is now ` +
    `holding ${formatBytes(held)}` +
    (forUndo > 0
      ? `, of which ${formatBytes(forUndo)} is removed tracks kept so Ctrl+Z ` +
        `can bring them back`
      : "") +
    `. Nothing already loaded was removed.`
  );
}
