/**
 * **Saved projects** — a track's work, kept across a reload. Ticket 038.
 *
 * ## What a project is
 *
 * A project is the **work**, never the audio: regions, the stack, the export
 * overrides and the join layout — exactly `TrackWork`. The browser will not let
 * a page re-open a file by itself, so the audio cannot come back without the
 * user; what comes back is everything they did to it, the moment they drop the
 * same file again.
 *
 * ## Two ways it is kept
 *
 * - **Autosave**, in `localStorage`, keyed by the file's name and size. Drop
 *   `interview.wav` tomorrow and its regions are where you left them, with a
 *   note on the card saying so and a **Start fresh** beside it. The newest 100
 *   files are kept, and the oldest are dropped first past that or past about
 *   2 MB — a project is small, but a noise profile is a few kilobytes and
 *   storage is shared with the rest of the site.
 * - **A project file**, `.soundslice.json`, saved and opened from the toolbar.
 *   It holds every track on the page, so a session can move to another machine
 *   or be kept for good.
 *
 * ## The rules that keep it safe
 *
 * - **Anything unknown discards the record.** An unknown version, an operation
 *   this build does not know, a number that is not a number — the record is
 *   dropped, never half-applied. Restoring part of someone's work and silently
 *   leaving the rest out is worse than restoring none of it: they would not
 *   know what they lost. `persisted.ts` already treats stored settings this way.
 * - **Region ids are minted again.** Ids are only unique within one session's
 *   counter, so a restored `ss-region-3` could collide with one made a second
 *   later. Every id the record names — the selection, the join order, the
 *   crossfades — is moved to the new id with it.
 * - **The view, the master defaults and the region tool settings are not in
 *   it.** Those describe how this person works, not what any one file is made
 *   of, and they already persist on their own.
 *
 * Plain functions, no store and no DOM, so Vitest reads it under Node.
 */

import {
  EditStack,
  EqBand,
  Operation,
  Region,
  newRegionId,
} from "./edit-stack";
import { OutputFormat } from "./output-format";
import type { ExportOverrides, JoinLayout, TrackWork } from "./track-work";
import { readPersisted } from "./persisted";
import { serializeWork, workSignature } from "./work-signature";

export { serializeWork, workSignature };

export const PROJECTS_STORAGE_KEY = "projects";
export const PROJECTS_STORAGE_VERSION = 1;

/** What a project file says it is, so a random JSON file is refused. */
export const PROJECT_FILE_FORMAT = "soundslice-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = ".soundslice.json";

/** The most files autosave remembers. */
export const MAX_SAVED_PROJECTS = 100;

/** About how much autosave may write, in characters of JSON. */
export const MAX_SAVED_CHARS = 2_000_000;

/** One remembered file. `work` is JSON-safe: see `serializeWork`. */
export type SavedEntry = { savedAt: number; work: unknown };

export type SavedProjects = { entries: Record<string, SavedEntry> };

export const EMPTY_SAVED_PROJECTS: SavedProjects = { entries: {} };

/**
 * Which file a record belongs to.
 *
 * Name **and size**: two takes both called `take.wav` are told apart by their
 * length in bytes, which is the only other thing a dropped `File` reliably
 * says. `lastModified` is not used — a copy of the same file to another folder
 * changes it, and that is still the same recording.
 */
export function projectKey(file: { name: string; size: number }): string {
  return `${file.name}:${file.size}`;
}

/* ------------------------------------------------------------------------ */
/* Writing                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Autosave's store with one file's work written in, oldest dropped past the
 * limits. Returns a new object; the old one is not changed.
 */
export function rememberWork(
  saved: SavedProjects,
  key: string,
  work: TrackWork,
  now: number
): SavedProjects {
  const entries = { ...saved.entries };

  // A track with nothing done to it is not worth remembering, and must not
  // push out one that is. It also forgets a file the user has started fresh.
  if (isBlankWork(work)) delete entries[key];
  else entries[key] = { savedAt: now, work: serializeWork(work) };

  const newestFirst = Object.entries(entries).sort(
    ([, a], [, b]) => b.savedAt - a.savedAt
  );

  const kept: Record<string, SavedEntry> = {};
  let chars = 0;

  for (const [entryKey, entry] of newestFirst) {
    if (Object.keys(kept).length >= MAX_SAVED_PROJECTS) break;
    const size = JSON.stringify(entry).length + entryKey.length;
    if (chars + size > MAX_SAVED_CHARS) break;
    kept[entryKey] = entry;
    chars += size;
  }

  return { entries: kept };
}

/** True for a track with nothing at all on it. Never worth remembering. */
export function isBlankWork(work: TrackWork): boolean {
  return (
    work.regions.length === 0 &&
    !work.stack &&
    !work.exportOverrides &&
    !work.join
  );
}

/** A project file holding every track on the page. */
export function projectFile(
  tracks: Array<{ file: { name: string; size: number } } & TrackWork>
): string {
  return JSON.stringify(
    {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      tracks: tracks.map((track) => ({
        fileName: track.file.name,
        size: track.file.size,
        work: serializeWork({
          regions: track.regions,
          selectedRegionId: track.selectedRegionId,
          stack: track.stack,
          exportOverrides: track.exportOverrides,
          join: track.join,
        }),
      })),
    },
    null,
    2
  );
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

export function isSavedProjects(value: unknown): value is SavedProjects {
  if (!isRecord(value) || !isRecord(value.entries)) return false;
  return Object.values(value.entries).every(
    (entry) => isRecord(entry) && isFiniteNumber(entry.savedAt)
  );
}

/** One track of an opened project file. */
export type ProjectTrack = { fileName: string; size: number; work: TrackWork };

/**
 * Reads a project file. `null` for anything that is not one this build can read
 * **completely** — see "the rules that keep it safe".
 */
export function readProjectFile(text: string): ProjectTrack[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    !isRecord(parsed) ||
    parsed.format !== PROJECT_FILE_FORMAT ||
    parsed.version !== PROJECT_FILE_VERSION ||
    !Array.isArray(parsed.tracks)
  ) {
    return null;
  }

  const tracks: ProjectTrack[] = [];
  for (const track of parsed.tracks) {
    if (
      !isRecord(track) ||
      typeof track.fileName !== "string" ||
      !isFiniteNumber(track.size)
    ) {
      return null;
    }
    const work = parseWork(track.work);
    if (!work) return null;
    tracks.push({ fileName: track.fileName, size: track.size, work });
  }

  return tracks;
}

/**
 * Stored work, checked field by field and given fresh region ids. `null` when
 * anything in it is not understood.
 */
export function parseWork(value: unknown): TrackWork | null {
  if (!isRecord(value) || !Array.isArray(value.regions)) return null;

  const regions: Region[] = [];
  for (const raw of value.regions) {
    const region = parseRegion(raw);
    if (!region) return null;
    regions.push(region);
  }

  // Old id to new, for everything else in the record that names a region.
  const ids = new Map<string, string>();
  const fresh = regions.map((region) => {
    const id = newRegionId();
    ids.set(region.id, id);
    return { ...region, id };
  });

  let stack: EditStack | undefined;
  if (value.stack !== undefined) {
    if (!Array.isArray(value.stack)) return null;
    stack = [];
    for (const raw of value.stack) {
      const operation = parseOperation(raw);
      if (!operation) return null;
      stack.push(operation);
    }
  }

  let exportOverrides: ExportOverrides | undefined;
  if (value.exportOverrides !== undefined) {
    const parsed = parseOverrides(value.exportOverrides);
    if (!parsed) return null;
    exportOverrides = parsed;
  }

  let join: JoinLayout | undefined;
  if (value.join !== undefined) {
    const parsed = parseJoin(value.join, ids);
    if (!parsed) return null;
    join = parsed;
  }

  if (
    value.selectedRegionId !== undefined &&
    typeof value.selectedRegionId !== "string"
  ) {
    return null;
  }

  return {
    regions: fresh,
    selectedRegionId:
      typeof value.selectedRegionId === "string"
        ? ids.get(value.selectedRegionId)
        : undefined,
    stack,
    exportOverrides,
    join,
  };
}

function parseRegion(value: unknown): Region | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isFiniteNumber(value.start) ||
    !isFiniteNumber(value.end) ||
    value.start < 0 ||
    value.end < value.start ||
    !isFiniteNumber(value.gainDb) ||
    !isRecord(value.fade) ||
    !isFiniteNumber(value.fade.inMs) ||
    !isFiniteNumber(value.fade.outMs)
  ) {
    return null;
  }

  if (value.name !== undefined && typeof value.name !== "string") return null;

  let stretch: Region["stretch"];
  if (value.stretch !== undefined) {
    if (
      !isRecord(value.stretch) ||
      !isFiniteNumber(value.stretch.rate) ||
      value.stretch.rate <= 0 ||
      !isFiniteNumber(value.stretch.semitones)
    ) {
      return null;
    }
    stretch = { rate: value.stretch.rate, semitones: value.stretch.semitones };
  }

  return {
    id: value.id,
    start: value.start,
    end: value.end,
    gainDb: value.gainDb,
    fade: { inMs: value.fade.inMs, outMs: value.fade.outMs },
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(stretch ? { stretch } : {}),
  };
}

const FILTER_TYPES: BiquadFilterType[] = [
  "lowpass",
  "highpass",
  "bandpass",
  "lowshelf",
  "highshelf",
  "peaking",
  "notch",
  "allpass",
];

function parseOperation(value: unknown): Operation | null {
  if (!isRecord(value)) return null;
  const numbers = (...keys: string[]) =>
    keys.every((key) => isFiniteNumber(value[key]));

  switch (value.op) {
    case "gain":
      return numbers("db") ? { op: "gain", db: value.db as number } : null;
    case "limiter":
      return numbers("ceilingDb")
        ? { op: "limiter", ceilingDb: value.ceilingDb as number }
        : null;
    case "peakNormalization":
      return numbers("targetDbfs")
        ? { op: "peakNormalization", targetDbfs: value.targetDbfs as number }
        : null;
    case "loudness":
      return numbers("targetLufs", "ceilingDbTp")
        ? {
            op: "loudness",
            targetLufs: value.targetLufs as number,
            ceilingDbTp: value.ceilingDbTp as number,
          }
        : null;
    case "compressor":
      return numbers("thresholdDb", "ratio", "kneeDb", "attackMs", "releaseMs")
        ? {
            op: "compressor",
            thresholdDb: value.thresholdDb as number,
            ratio: value.ratio as number,
            kneeDb: value.kneeDb as number,
            attackMs: value.attackMs as number,
            releaseMs: value.releaseMs as number,
          }
        : null;
    case "eq": {
      if (!Array.isArray(value.bands)) return null;
      const bands: EqBand[] = [];
      for (const band of value.bands) {
        if (
          !isRecord(band) ||
          !FILTER_TYPES.includes(band.type as BiquadFilterType) ||
          !isFiniteNumber(band.hz) ||
          !isFiniteNumber(band.db) ||
          !isFiniteNumber(band.q)
        ) {
          return null;
        }
        bands.push({
          type: band.type as BiquadFilterType,
          hz: band.hz,
          db: band.db,
          q: band.q,
        });
      }
      return { op: "eq", bands };
    }
    case "noiseReduction": {
      const profile = value.profile;
      if (
        !numbers("amount") ||
        !isRecord(profile) ||
        typeof profile.id !== "string" ||
        typeof profile.magnitudes !== "string" ||
        !isFiniteNumber(profile.fftSize) ||
        !isFiniteNumber(profile.sampleRate)
      ) {
        return null;
      }
      const magnitudes = fromBase64(profile.magnitudes);
      if (!magnitudes || magnitudes.length !== profile.fftSize / 2 + 1) {
        return null;
      }
      const fromSec =
        isRecord(profile.fromSec) &&
        isFiniteNumber(profile.fromSec.start) &&
        isFiniteNumber(profile.fromSec.end)
          ? { start: profile.fromSec.start, end: profile.fromSec.end }
          : undefined;
      return {
        op: "noiseReduction",
        amount: value.amount as number,
        profile: {
          id: profile.id,
          magnitudes,
          fftSize: profile.fftSize,
          sampleRate: profile.sampleRate,
          ...(fromSec ? { fromSec } : {}),
        },
      };
    }
    default:
      // An operation this build does not know. The whole record goes.
      return null;
  }
}

function parseOverrides(value: unknown): ExportOverrides | null {
  if (!isRecord(value)) return null;
  const overrides: ExportOverrides = {};

  if (value.exportFileType !== undefined) {
    if (!Object.values(OutputFormat).includes(value.exportFileType as OutputFormat)) {
      return null;
    }
    overrides.exportFileType = value.exportFileType as OutputFormat;
  }
  if (value.bitDepth !== undefined) {
    if (value.bitDepth !== 16 && value.bitDepth !== 24) return null;
    overrides.bitDepth = value.bitDepth;
  }
  if (value.outputSampleRate !== undefined) {
    if (value.outputSampleRate !== null && !isFiniteNumber(value.outputSampleRate)) {
      return null;
    }
    overrides.outputSampleRate = value.outputSampleRate;
  }

  return overrides;
}

function parseJoin(value: unknown, ids: Map<string, string>): JoinLayout | null {
  if (!isRecord(value)) return null;
  const join: JoinLayout = {};

  if (value.order !== undefined) {
    if (!Array.isArray(value.order) || !value.order.every((id) => typeof id === "string")) {
      return null;
    }
    join.order = (value.order as string[])
      .map((id) => ids.get(id))
      .filter((id): id is string => id !== undefined);
  }

  if (value.crossfadeMs !== undefined) {
    if (!isRecord(value.crossfadeMs)) return null;
    const crossfadeMs: Record<string, number> = {};
    for (const [id, ms] of Object.entries(value.crossfadeMs)) {
      if (!isFiniteNumber(ms)) return null;
      const moved = ids.get(id);
      if (moved) crossfadeMs[moved] = ms;
    }
    join.crossfadeMs = crossfadeMs;
  }

  return join;
}

/* ------------------------------------------------------------------------ */
/* Small helpers                                                             */
/* ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fromBase64(text: string): Float32Array | null {
  try {
    const binary = atob(text);
    if (binary.length % 4 !== 0) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const samples = new Float32Array(bytes.buffer);
    return samples.every(Number.isFinite) ? samples : null;
  } catch {
    return null;
  }
}

/**
 * The work autosave remembered for this file, or `null`.
 *
 * What a card asks once, when it first seeds. A record that does not parse is
 * `null` — never half-applied.
 */
export function savedWorkFor(file: { name: string; size: number }): TrackWork | null {
  const saved = readPersisted(
    PROJECTS_STORAGE_KEY,
    PROJECTS_STORAGE_VERSION,
    isSavedProjects
  );
  const entry = saved?.entries[projectKey(file)];
  if (!entry) return null;

  const work = parseWork(entry.work);
  return work && work.regions.length > 0 ? work : null;
}
