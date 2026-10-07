import { useState } from "react";
import {
  MagicWandIcon,
  PlusIcon,
  ReloadIcon,
  ScissorsIcon,
} from "@radix-ui/react-icons";
import { TimerGlyph, BoltGlyph } from "./glyphs";
import { selectedRegion, useAudioStore } from "@/stores/audio-store";
import {
  SILENCE_DEFAULTS,
  SILENCE_RANGES,
  SilenceSettings,
} from "@/lib/silence";
import { ensureTransients, splitTrackOnSilence } from "@/lib/region-tools";
import {
  TRANSIENT_SPLIT_DEFAULTS,
  TRANSIENT_SPLIT_RANGES,
  TransientSplitSettings,
  clampSplitSettings,
  regionsFromOnsets,
} from "@/lib/transient-split";
import {
  DEFAULT_FADE_MS,
  defaultRegion,
  isStretched,
  regionLabel,
} from "@/lib/edit-stack";
import { countRender } from "@/lib/render-count";
// The three small controls live in one place now, so the region strip and the
// signal chain cannot drift into looking like two different applications.
import { Popover, ToolButton, ToolSlider } from "./ToolControls";

/**
 * The region tools, as a strip above the waveform.
 *
 * They were three sliders and a switch in an accordion below the card. A tool
 * belongs next to the thing it acts on, and the thing it acts on is the
 * waveform — so this sits directly above it and the three numbers hide inside a
 * popover until they are asked for.
 *
 * Only the **tools** are here. Everything a single region owns — its gain, its
 * fades, its name — is drawn on the region itself. See `region-overlay.ts`.
 *
 * Advanced view only, and lazy-loaded. Standing rule 6.
 */
export default function RegionToolbar({
  fileName,
  durationSec,
}: {
  fileName: string;
  /** The file's length, so a new region cannot be made past the end of it. */
  durationSec: number;
}) {
  if (import.meta.env.DEV) countRender(`RegionToolbar:${fileName}`);

  const snap = useAudioStore((state) => state.snapToTransients);
  const setSnap = useAudioStore((state) => state.setSnapToTransients);
  const addTrackRegion = useAudioStore((state) => state.addTrackRegion);
  const count = useAudioStore(
    (state) =>
      state.tracks.find((t) => t.file.name === fileName)?.regions.length ?? 0
  );

  const [splitOpen, setSplitOpen] = useState(false);
  const [transientsOpen, setTransientsOpen] = useState(false);
  const [stretchOpen, setStretchOpen] = useState(false);
  const stretched = useAudioStore((state) => {
    const region = selectedRegion(state.tracks.find((t) => t.file.name === fileName));
    return region ? isStretched(region) : false;
  });

  const addRegion = () => {
    const regions =
      useAudioStore.getState().getTrack(fileName)?.regions ?? [];
    const last = [...regions].sort((a, b) => a.end - b.end)[regions.length - 1];
    const gap = durationSec - (last?.end ?? 0);

    // After the last region when there is room, otherwise the last ten seconds
    // of the file. Overlap is legal, so landing on top of one is a valid answer
    // rather than a failure.
    const start = gap > 0.5 ? last?.end ?? 0 : Math.max(0, durationSec - 10);
    const end = Math.min(durationSec, start + Math.min(10, durationSec));

    addTrackRegion(fileName, defaultRegion(start, end));
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Popover
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        trigger={
          <ToolButton onClick={() => setSplitOpen((was) => !was)}>
            <ScissorsIcon className="mr-1.5" />
            Split on silence
            <span className="ml-1.5 text-muted-foreground">▾</span>
          </ToolButton>
        }
      >
        <SplitOnSilence fileName={fileName} onDone={() => setSplitOpen(false)} />
      </Popover>

      <Popover
        open={transientsOpen}
        onClose={() => setTransientsOpen(false)}
        trigger={
          <ToolButton onClick={() => setTransientsOpen((was) => !was)}>
            <BoltGlyph className="mr-1.5" />
            Split at transients
            <span className="ml-1.5 text-muted-foreground">▾</span>
          </ToolButton>
        }
      >
        <SplitAtTransients
          fileName={fileName}
          durationSec={durationSec}
          onDone={() => setTransientsOpen(false)}
        />
      </Popover>

      <Popover
        open={stretchOpen}
        onClose={() => setStretchOpen(false)}
        trigger={
          <ToolButton
            pressed={stretched}
            onClick={() => setStretchOpen((was) => !was)}
          >
            <TimerGlyph className="mr-1.5" />
            Time &amp; pitch
            <span className="ml-1.5 text-muted-foreground">▾</span>
          </ToolButton>
        }
      >
        <TimeAndPitch fileName={fileName} />
      </Popover>

      <ToolButton pressed={snap} onClick={() => setSnap(!snap)}>
        <MagicWandIcon className="mr-1.5" />
        Snap
      </ToolButton>

      <ToolButton onClick={addRegion}>
        <PlusIcon className="mr-1.5" />
        Region
      </ToolButton>

      <span className="ml-auto text-xs text-muted-foreground">
        {count} {count === 1 ? "region" : "regions"}
        {snap && " · hold Alt to ignore the magnet"}
      </span>
    </div>
  );
}

function SplitOnSilence({
  fileName,
  onDone,
}: {
  fileName: string;
  onDone: () => void;
}) {
  const stored = useAudioStore((state) => state.silenceSettings);
  const setSilenceSettings = useAudioStore((state) => state.setSilenceSettings);
  const setTrackRegions = useAudioStore((state) => state.setTrackRegions);

  // Clamped on the way in. A stored value may predate a range change, and the
  // guard that read it from storage only checks that it is a number.
  const settings = clampSilence(stored ?? SILENCE_DEFAULTS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const change = (patch: Partial<SilenceSettings>) =>
    setSilenceSettings({ ...settings, ...patch });

  const run = async () => {
    const track = useAudioStore.getState().getTrack(fileName);
    if (!track) return;

    setRunning(true);
    setProgress(0);

    try {
      const regions = await splitTrackOnSilence(track.file, settings, {
        onProgress: setProgress,
      });

      // One call, so **one undo entry**. Split on silence replaces every region
      // on the track, and one Ctrl+Z has to put the previous list back exactly.
      setTrackRegions(fileName, regions, { label: "Split on silence" });
      onDone();
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  return (
    <div className="flex w-80 flex-col gap-2">
      <ToolSlider
        label="Silence below"
        display={`${settings.thresholdDb} dBFS`}
        value={settings.thresholdDb}
        range={SILENCE_RANGES.thresholdDb}
        onChange={(thresholdDb) => change({ thresholdDb })}
      />
      <ToolSlider
        label="Lasting at least"
        display={`${settings.minSilenceMs} ms`}
        value={settings.minSilenceMs}
        range={SILENCE_RANGES.minSilenceMs}
        onChange={(minSilenceMs) => change({ minSilenceMs })}
      />
      <ToolSlider
        label="Keep padding"
        display={`${settings.paddingMs} ms`}
        value={settings.paddingMs}
        range={SILENCE_RANGES.paddingMs}
        onChange={(paddingMs) => change({ paddingMs })}
      />

      <button
        onClick={run}
        disabled={running}
        className="mt-1 flex h-8 items-center justify-center rounded bg-primary px-3 text-xs text-primary-foreground disabled:opacity-60"
      >
        {running ? (
          <>
            <ReloadIcon className="mr-2 animate-spin" />
            Listening — {Math.round(progress * 100)}%
          </>
        ) : (
          <>
            <ScissorsIcon className="mr-2" />
            Split
          </>
        )}
      </button>

      <p className="text-xs text-muted-foreground">
        One region per stretch of sound. The silence between them is dropped, and
        each region keeps {settings.paddingMs} ms of it at either end so the{" "}
        {DEFAULT_FADE_MS} ms fade ramps over silence instead of over the attack.
        <b> This replaces every region on this track.</b> Ctrl+Z puts them back.
      </p>
    </div>
  );
}

function clampSilence(settings: SilenceSettings): SilenceSettings {
  const clamp = (value: number, range: { min: number; max: number }) =>
    Math.min(range.max, Math.max(range.min, value));

  return {
    thresholdDb: clamp(settings.thresholdDb, SILENCE_RANGES.thresholdDb),
    minSilenceMs: clamp(settings.minSilenceMs, SILENCE_RANGES.minSilenceMs),
    paddingMs: clamp(settings.paddingMs, SILENCE_RANGES.paddingMs),
  };
}

/**
 * **Split at transients** — one region per attack, replacing every region on
 * the track in one undo entry. Ticket 032. The maths is `transient-split.ts`.
 *
 * Detection is the magnet's own, cached per file, so a track the magnet has
 * already scanned splits at once.
 */
function SplitAtTransients({
  fileName,
  durationSec,
  onDone,
}: {
  fileName: string;
  durationSec: number;
  onDone: () => void;
}) {
  const stored = useAudioStore((state) => state.transientSplitSettings);
  const setStored = useAudioStore((state) => state.setTransientSplitSettings);
  const setTrackRegions = useAudioStore((state) => state.setTrackRegions);

  const settings = clampSplitSettings(stored ?? TRANSIENT_SPLIT_DEFAULTS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [found, setFound] = useState<number | null>(null);

  const change = (patch: Partial<TransientSplitSettings>) =>
    setStored({ ...settings, ...patch });

  const run = async () => {
    const track = useAudioStore.getState().getTrack(fileName);
    if (!track) return;

    setRunning(true);
    setProgress(0);

    try {
      const onsets = await ensureTransients(track.file, undefined, {
        onProgress: setProgress,
      });
      const regions = regionsFromOnsets(onsets, durationSec, settings);

      // Nothing to cut at is said, not acted on. Replacing every region with
      // none would be a surprising way to learn the file has no attacks.
      setFound(regions.length);
      if (regions.length === 0) return;

      // One call, so **one undo entry**, exactly as split on silence.
      setTrackRegions(fileName, regions, { label: "Split at transients" });
      onDone();
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  return (
    <div className="flex w-80 flex-col gap-2">
      <ToolSlider
        label="Shortest region"
        display={`${settings.minRegionMs} ms`}
        value={settings.minRegionMs}
        range={TRANSIENT_SPLIT_RANGES.minRegionMs}
        onChange={(minRegionMs) => change({ minRegionMs })}
      />
      <ToolSlider
        label="Start before hit"
        display={`${settings.leadInMs} ms`}
        value={settings.leadInMs}
        range={TRANSIENT_SPLIT_RANGES.leadInMs}
        onChange={(leadInMs) => change({ leadInMs })}
      />

      <button
        onClick={run}
        disabled={running}
        className="mt-1 flex h-8 items-center justify-center rounded bg-primary px-3 text-xs text-primary-foreground disabled:opacity-60"
      >
        {running ? (
          <>
            <ReloadIcon className="mr-2 animate-spin" />
            Listening — {Math.round(progress * 100)}%
          </>
        ) : (
          <>
            <BoltGlyph className="mr-2" />
            Split
          </>
        )}
      </button>

      {found === 0 && (
        <p className="text-xs text-amber-500">
          No attacks found in this file. Nothing was changed.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        One region per hit. Each starts {settings.leadInMs} ms before its attack
        and runs to the next, so joined they play the file back.
        <b> This replaces every region on this track.</b> Ctrl+Z puts them back.
      </p>
    </div>
  );
}

/** What the two time and pitch controls may be set to. */
const STRETCH_RANGES = {
  rate: { min: 0.5, max: 2, step: 0.01 },
  semitones: { min: -12, max: 12, step: 1 },
} as const;

/**
 * **Time and pitch** for the selected region. Ticket 037.
 *
 * Speed and pitch are separate: speed 1.5 at 0 semitones is faster at the same
 * pitch; speed 1 at +12 is an octave up at the same length. Both apply to the
 * export and to preview. The region's bounds stay in the file's own seconds —
 * what changes is how long it lasts once played.
 */
function TimeAndPitch({ fileName }: { fileName: string }) {
  const region = useAudioStore((state) =>
    selectedRegion(state.tracks.find((t) => t.file.name === fileName))
  );
  const regions = useAudioStore(
    (state) => state.tracks.find((t) => t.file.name === fileName)?.regions
  );
  const updateTrackRegion = useAudioStore((state) => state.updateTrackRegion);

  // One drag of one slider is one undo entry. Letting go bumps it.
  const [gesture, setGesture] = useState(0);

  if (!region || !regions) {
    return (
      <p className="w-72 text-xs text-muted-foreground">
        Select a region to change its speed or pitch.
      </p>
    );
  }

  const rate = region.stretch?.rate ?? 1;
  const semitones = region.stretch?.semitones ?? 0;

  const set = (next: { rate: number; semitones: number }, what: string) =>
    updateTrackRegion(
      fileName,
      region.id,
      // Speed 1 and 0 semitones is no stretch, and is stored as none, so the
      // Advanced settings chip stops counting it.
      { stretch: next.rate === 1 && next.semitones === 0 ? undefined : next },
      {
        label: "Time and pitch",
        coalesceKey: `stretch:${region.id}:${what}:${gesture}`,
      }
    );

  const lasts = (region.end - region.start) / rate;

  return (
    <div className="flex w-80 flex-col gap-2">
      <span className="text-xs font-medium">{regionLabel(regions, region)}</span>
      <ToolSlider
        label="Speed"
        display={`${rate.toFixed(2)}×`}
        value={rate}
        range={STRETCH_RANGES.rate}
        onChange={(value) => set({ rate: value, semitones }, "rate")}
        onCommit={() => setGesture((n) => n + 1)}
      />
      <ToolSlider
        label="Pitch"
        display={`${semitones > 0 ? "+" : semitones < 0 ? "−" : ""}${Math.abs(semitones)} st`}
        value={semitones}
        range={STRETCH_RANGES.semitones}
        onChange={(value) => set({ rate, semitones: value }, "pitch")}
        onCommit={() => setGesture((n) => n + 1)}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Plays for {lasts.toFixed(2)} s
        </span>
        {(rate !== 1 || semitones !== 0) && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-primary"
            onClick={() => {
              set({ rate: 1, semitones: 0 }, "reset");
              setGesture((n) => n + 1);
            }}
          >
            Reset
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        The export resamples for speed and shifts pitch with a phase vocoder.
        Preview uses the browser's own speed control and the same pitch shifter,
        so it sounds the same but for the finest detail, about 43 ms late.
      </p>
    </div>
  );
}
