import { Suspense, lazy } from "react";
import { DownloadIcon, PauseIcon, PlayIcon, ReloadIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MeterSource } from "@/lib/preview";
import { formatClock } from "@/lib/region-table";

const RegionToolbar = lazy(() => import("./RegionToolbar"));
const TransportMeters = lazy(() => import("./TransportMeters"));

/**
 * The open track's header and transport in Advanced view: everything the
 * card draws above and below the waveform that Simple view does not.
 *
 * Here and not in `AudioEditor`, so a Simple view user never downloads it.
 * Standing rule 6. The card keeps the state — playback, the export, the clock
 * — and these only draw it.
 */

export function TrackHeader({
  fileName,
  ready,
  channels,
  durationSec,
  regionCount,
  removeButton,
}: {
  fileName: string;
  ready: boolean;
  channels: number;
  durationSec: number;
  regionCount: number;
  removeButton: React.ReactNode;
}) {
  const facts = [
    channels === 1 ? "mono" : channels === 2 ? "stereo" : `${channels} channels`,
    formatClock(durationSec),
    `${regionCount} ${regionCount === 1 ? "region" : "regions"}`,
  ].join(" · ");

  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-lg font-semibold" title={fileName}>
            {fileName}
          </h2>
          {removeButton}
        </div>
        {ready && <p className="font-mono text-xs text-muted-foreground">{facts}</p>}
      </div>
      {ready && (
        <Suspense fallback={null}>
          <RegionToolbar fileName={fileName} durationSec={durationSec} />
        </Suspense>
      )}
    </div>
  );
}

export function TrackTransport({
  playing,
  onPlayPause,
  clock,
  durationSec,
  meters,
  onZoom,
  downloading,
  onSlice,
  onCancel,
}: {
  playing: boolean;
  onPlayPause: () => void;
  /** Receives the clock's element; the card writes the time into it. */
  clock: (element: HTMLSpanElement | null) => void;
  durationSec: number;
  meters: MeterSource;
  onZoom: (value: number[]) => void;
  downloading: boolean;
  onSlice: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex cursor-default flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        onClick={onPlayPause}
        variant="outline"
        size="icon"
        className="h-9 w-9 rounded-full"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <code className="text-xs tabular-nums">
        <span ref={clock} />
        <span className="text-muted-foreground">
          {" / "}
          {formatClock(durationSec)}
        </span>
      </code>
      {/*
        Nothing here renders per frame — the level is written onto a canvas
        from an animation frame. See `useMeterPair`.
      */}
      <Suspense fallback={null}>
        <TransportMeters meters={meters} />
      </Suspense>
      <div className="flex w-44 items-center gap-2 text-xs text-muted-foreground">
        Zoom
        <Slider
          defaultValue={[0]}
          min={0}
          max={200}
          step={0.1}
          onValueChange={onZoom}
          aria-label="Zoom"
        />
      </div>
      <span className="flex-1" />
      {downloading ? (
        // The running export's own button becomes its Cancel. Ticket 035.
        <Button onClick={onCancel} variant="outline" className="h-9 px-4">
          <ReloadIcon className="animate-spin" />
          <span className="ml-2">Cancel</span>
        </Button>
      ) : (
        <Button
          onClick={onSlice}
          variant="outline"
          className="h-9 px-4"
          title="Export this track only"
        >
          <DownloadIcon />
          <span className="ml-2">Slice this track</span>
        </Button>
      )}
    </div>
  );
}

/** For `React.lazy`, which needs a default export. */
export default TrackHeader;
