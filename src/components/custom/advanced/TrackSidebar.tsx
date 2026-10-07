import { Suspense, lazy, useRef, useState } from "react";
import { DownloadIcon, ReloadIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOfferedFormats } from "@/components/custom/MasterToolbar";
import { useSliceAll } from "@/hooks/useSliceAll";
import { masterExportSettings, useAudioStore } from "@/stores/audio-store";
import type { EditorTrack } from "@/stores/audio-store";
import { TrackOverview, useWorkspace } from "@/stores/workspace";
import { AudioService } from "@/lib/audio-service";
import { FORMAT_LABEL } from "@/lib/output-format";
import { hasExportOverrides } from "@/lib/track-work";
import { stemOf } from "@/lib/file-names";
import { formatClock } from "@/lib/region-table";
import { PanelLeftGlyph } from "./glyphs";

const LoudnessTarget = lazy(() => import("./LoudnessTarget"));
const MasterExportOptions = lazy(() => import("./MasterExportOptions"));

/**
 * **The track list**: Advanced view's left-hand pane.
 *
 * Every loaded track as one short row, so ten tracks are ten rows rather than
 * ten full cards to scroll past. Clicking a row opens that track in the middle
 * pane. Under the list sit the **master output** settings and **Slice all** —
 * what the master toolbar holds in Simple view, in one place that does not
 * move however many tracks there are.
 *
 * Collapsed, it is a rail: a button per track and Slice all.
 */
export default function TrackSidebar({
  fileNames,
  openName,
}: {
  fileNames: string[];
  openName: string | undefined;
}) {
  const collapsed = useWorkspace((state) => state.collapsed.tracks);
  const toggle = useWorkspace((state) => state.toggleCollapsed);
  const setActive = useWorkspace((state) => state.setActiveTrack);
  const overview = useWorkspace((state) => state.overview);
  const tracks = useAudioStore((state) => state.tracks);
  const addFiles = useAudioStore((state) => state.addFiles);
  const fileCount = useAudioStore(
    (state) => AudioService.planSlices(state.tracks, masterExportSettings()).length
  );
  const { downloading, sliceAll } = useSliceAll();

  const sliceLabel = `Slice all · ${fileCount} ${fileCount === 1 ? "file" : "files"}`;

  if (collapsed) {
    return (
      <nav
        aria-label="Tracks"
        className="flex h-full w-[52px] shrink-0 flex-col items-center gap-2 border-r border-border bg-muted/10 py-3"
      >
        <RailButton label="Show the track list" onClick={() => toggle("tracks")}>
          <PanelLeftGlyph open={false} />
        </RailButton>
        <span className="my-1 h-px w-6 bg-border" />
        {fileNames.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            aria-current={name === openName}
            onClick={() => setActive(name)}
            className={`grid h-9 w-9 place-items-center rounded-md border text-[11px] font-semibold ${
              name === openName
                ? "border-foreground/60 bg-muted"
                : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
            }`}
          >
            {initials(name)}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          aria-label={sliceLabel}
          title={sliceLabel}
          disabled={downloading}
          onClick={sliceAll}
          className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {downloading ? <ReloadIcon className="animate-spin" /> : <DownloadIcon />}
        </button>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Tracks"
      className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-muted/10"
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tracks · {fileNames.length}
        </span>
        <span className="flex items-center gap-1">
          <AddFiles onFiles={addFiles} />
          <RailButton label="Collapse the track list" small onClick={() => toggle("tracks")}>
            <PanelLeftGlyph open />
          </RailButton>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-1 px-2">
          {fileNames.map((name) => {
            const track = tracks.find((one) => one.file.name === name);
            return (
              <li key={name}>
                <TrackRow
                  name={name}
                  track={track}
                  overview={overview[name]}
                  open={name === openName}
                  onOpen={() => setActive(name)}
                />
              </li>
            );
          })}
        </ul>

        <MasterOutput />
      </div>

      <div className="border-t border-border p-3">
        <Button
          className="h-10 w-full font-semibold"
          disabled={downloading}
          onClick={sliceAll}
        >
          {downloading ? (
            <ReloadIcon className="mr-2 animate-spin" />
          ) : (
            <DownloadIcon className="mr-2" />
          )}
          {sliceLabel}
        </Button>
      </div>
    </nav>
  );
}

function TrackRow({
  name,
  track,
  overview,
  open,
  onOpen,
}: {
  name: string;
  track: EditorTrack | undefined;
  overview: TrackOverview | undefined;
  open: boolean;
  onOpen: () => void;
}) {
  const regionCount = track?.regions.length ?? 0;
  const tags = [
    `${regionCount} ${regionCount === 1 ? "region" : "regions"}`,
    track?.stack ? "own chain" : null,
    track?.exportOverrides?.exportFileType
      ? FORMAT_LABEL[track.exportOverrides.exportFileType]
      : hasExportOverrides(track?.exportOverrides)
        ? "own export"
        : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      aria-current={open}
      onClick={onOpen}
      className={`flex w-full flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors ${
        open
          ? "border-foreground/30 bg-muted"
          : "border-transparent hover:bg-muted/40"
      }`}
    >
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {overview ? formatClock(overview.durationSec).replace(/\.\d+$/, "") : ""}
        </span>
      </span>
      <MiniWave peaks={overview?.peaks} bright={open} />
      <span className="text-[11px] text-muted-foreground">{tags.join(" · ")}</span>
    </button>
  );
}

/** The track's shape, small: one line per peak. Empty until it has loaded. */
function MiniWave({ peaks, bright }: { peaks: number[] | undefined; bright: boolean }) {
  const height = 22;
  if (!peaks || peaks.length === 0) {
    return <span className="block h-[22px] w-full rounded-sm bg-muted/40" />;
  }

  const width = peaks.length * 3;
  const path = peaks
    .map((peak, index) => {
      const h = Math.max(1, peak * height);
      const x = index * 3 + 1;
      return `M${x} ${(height - h) / 2}v${h}`;
    })
    .join("");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-[22px] w-full"
      aria-hidden
    >
      <path
        d={path}
        stroke={bright ? "#a3a3a3" : "#525252"}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The master defaults, stacked to fit the list's width. */
function MasterOutput() {
  const normalizeAudio = useAudioStore((state) => state.normalizeAudio);
  const setNormalizeAudio = useAudioStore((state) => state.setNormalizeAudio);
  const applyPostProcessing = useAudioStore((state) => state.applyPostProcessing);
  const setApplyPostProcessing = useAudioStore(
    (state) => state.setApplyPostProcessing
  );
  const exportFileType = useAudioStore((state) => state.exportFileType);
  const setExportFileType = useAudioStore((state) => state.setExportFileType);
  const formats = useOfferedFormats(true, exportFileType);

  return (
    <section
      aria-label="Master output"
      className="mt-4 flex flex-col gap-3 border-t border-border px-3 py-3"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Master output
      </span>

      <Field label="Format">
        <Select value={exportFileType} onValueChange={setExportFileType}>
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formats.map((format) => (
              <SelectItem key={format} value={format}>
                {FORMAT_LABEL[format]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Suspense fallback={null}>
        <MasterExportOptions />
      </Suspense>

      <Field label="Normalize levels">
        <Select
          value={normalizeAudio.toString()}
          onValueChange={(value) => setNormalizeAudio(value === "true")}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {normalizeAudio && (
        <Suspense fallback={null}>
          <LoudnessTarget />
        </Suspense>
      )}

      <Field label="Post-processing">
        <Select
          value={applyPostProcessing.toString()}
          onValueChange={(value) => setApplyPostProcessing(value === "true")}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </section>
  );
}

/**
 * The track list's **+**: pick files, or drop them on it.
 *
 * It hands them straight to the store. The drop zone's progress bars time a
 * read nothing uses, and the store already refuses what it cannot take.
 */
function AddFiles({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // A drop can carry anything, so it keeps only audio, as the drop zone does.
  // The picker already asks for audio, and some audio has no MIME type.
  const take = (list: FileList | null, dropped: boolean) => {
    const files = Array.from(list ?? []).filter(
      (file) => !dropped || file.type.includes("audio")
    );
    if (files.length > 0) onFiles(files);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Add files"
        title="Add files — or drop them here"
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files, true);
        }}
        className={`grid h-7 w-7 place-items-center rounded border text-muted-foreground hover:border-foreground/40 hover:text-foreground ${
          over ? "border-primary text-foreground" : "border-border bg-muted/40"
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
          <path d="M7.5 3v9M3 7.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        aria-label="Add audio files"
        onChange={(event) => {
          take(event.target.files, false);
          event.target.value = "";
        }}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RailButton({
  label,
  onClick,
  small = false,
  children,
}: {
  label: string;
  onClick: () => void;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid place-items-center rounded border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground ${
        small ? "h-7 w-7" : "h-8 w-8"
      }`}
    >
      {children}
    </button>
  );
}

/** Two letters for a track's rail button: `alwaled_gibson.mp3` → `AG`. */
function initials(fileName: string): string {
  const words = stemOf(fileName)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const letters =
    words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
