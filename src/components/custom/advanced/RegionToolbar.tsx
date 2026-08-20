import { useState } from "react";
import {
  MagicWandIcon,
  PlusIcon,
  ReloadIcon,
  ScissorsIcon,
} from "@radix-ui/react-icons";
import { useAudioStore } from "@/stores/audio-store";
import {
  SILENCE_DEFAULTS,
  SILENCE_RANGES,
  SilenceSettings,
} from "@/lib/silence";
import { splitTrackOnSilence } from "@/lib/region-tools";
import { DEFAULT_FADE_MS, defaultRegion } from "@/lib/edit-stack";
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

  const settings = stored ?? SILENCE_DEFAULTS;
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
