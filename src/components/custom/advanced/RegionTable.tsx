import { useRef, useState } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Slider } from "@/components/ui/slider";
import { useAudioStore } from "@/stores/audio-store";
import { joins } from "@/lib/master-defaults";
import { isJoinReordered } from "@/lib/track-work";
import {
  moveInJoin,
  shiftInJoin,
  withCrossfade,
  withStartTimeOrder,
} from "@/lib/join-layout";
import {
  RegionRow,
  formatClock,
  formatFades,
  formatGain,
  formatStretch,
  regionRows,
} from "@/lib/region-table";
import { countRender } from "@/lib/render-count";
import { GripGlyph, JoinGlyph } from "./glyphs";
import { Popover } from "./ToolControls";

/** The longest crossfade offered, in milliseconds. Ticket 034's range. */
const MAX_CROSSFADE_MS = 2000;

/**
 * **The region table**: every region of the open track, one row each, under
 * the waveform. Advanced view only.
 *
 * It exists because a waveform cannot label a short region — a 0.3-second hit
 * is a few pixels wide, and its name was cut to "R…". A row always has room,
 * and it shows the numbers a drag can only approximate.
 *
 * ## It is the join order while a join is on
 *
 * With **Join** off the rows are in start-time order and the table only lists.
 * With it on, the rows are the order the joined file plays, and the table
 * takes the join strip's two jobs: drag a row (or press the arrow keys on its
 * grip) to move it, and set the crossfade into each row in its own column. A
 * bar above the table says so, and warns when the order is not start time.
 *
 * Clicking a row selects its region, the same selection the waveform shows.
 */
export default function RegionTable({ fileName }: { fileName: string }) {
  if (import.meta.env.DEV) countRender(`RegionTable:${fileName}`);

  const regions = useAudioStore(
    (state) => state.tracks.find((t) => t.file.name === fileName)?.regions
  );
  const layout = useAudioStore(
    (state) => state.tracks.find((t) => t.file.name === fileName)?.join
  );
  const selectedId = useAudioStore(
    (state) =>
      state.tracks.find((t) => t.file.name === fileName)?.selectedRegionId
  );
  const joinMode = useAudioStore((state) => state.joinMode);
  const setJoin = useAudioStore((state) => state.setTrackJoinLayout);
  const select = useAudioStore((state) => state.selectTrackRegion);
  const remove = useAudioStore((state) => state.removeTrackRegion);

  const dragging = useRef<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  if (!regions || regions.length === 0) return null;

  const joining = joins(joinMode);
  const rows = regionRows(regions, layout, joining);
  const reordered = joining && isJoinReordered(regions, layout);

  const reorder = (next: typeof layout) =>
    setJoin(fileName, next, { label: "Reorder join" });

  return (
    <section aria-label="Regions" className="flex flex-col gap-1">
      {joining && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <JoinGlyph className="text-foreground" />
          <span className="font-medium">Join order</span>
          <span className="text-muted-foreground">
            {joinMode === "all" ? "One file for everything" : "One file per track"}
            {" · rows play top to bottom · drag a row to move it"}
          </span>
          <span className="flex-1" />
          {reordered && (
            <>
              <span className="rounded-full border border-amber-800 px-2 py-0.5 text-[11px] text-amber-400">
                Not start-time order
              </span>
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setJoin(fileName, withStartTimeOrder(layout), {
                    label: "Reset join order",
                  })
                }
              >
                Reset order
              </button>
            </>
          )}
        </div>
      )}

      <table className="w-full border-collapse whitespace-nowrap text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            {joining && (
              <th scope="col" className="w-6 border-b border-border p-2">
                <span className="sr-only">Move</span>
              </th>
            )}
            {joining && <Header>Plays</Header>}
            <Header>Region</Header>
            <Header>Start</Header>
            <Header>Length</Header>
            <Header>Gain</Header>
            <Header>Fades</Header>
            <Header>Time &amp; pitch</Header>
            {joining && <Header>Crossfade in</Header>}
            <th scope="col" className="w-8 border-b border-border p-2">
              <span className="sr-only">Delete</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row
              key={row.region.id}
              row={row}
              joining={joining}
              selected={row.region.id === selectedId}
              dropTarget={dropOn === row.region.id}
              onSelect={() => select(fileName, row.region.id)}
              onDelete={() => remove(fileName, row.region.id)}
              onShift={(delta) =>
                reorder(shiftInJoin(regions, layout, row.region.id, delta))
              }
              onCrossfade={(ms, gesture) =>
                setJoin(fileName, withCrossfade(layout, row.region.id, ms), {
                  label: "Crossfade",
                  coalesceKey: `crossfade:${fileName}:${row.region.id}:${gesture}`,
                })
              }
              onDragStart={() => {
                dragging.current = row.region.id;
              }}
              onDragEnd={() => {
                dragging.current = null;
                setDropOn(null);
              }}
              onDragOver={() => {
                if (dragging.current && dragging.current !== row.region.id) {
                  setDropOn(row.region.id);
                }
              }}
              onDrop={() => {
                const moved = dragging.current;
                dragging.current = null;
                setDropOn(null);
                if (!moved || moved === row.region.id) return;
                reorder(moveInJoin(regions, layout, moved, row.region.id));
              }}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="border-b border-border px-1.5 py-2 font-medium">
      {children}
    </th>
  );
}

function Row({
  row,
  joining,
  selected,
  dropTarget,
  onSelect,
  onDelete,
  onShift,
  onCrossfade,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  row: RegionRow;
  joining: boolean;
  selected: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onShift: (delta: -1 | 1) => void;
  onCrossfade: (ms: number, gesture: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const { region } = row;
  const cell = "border-b border-border/60 px-1.5 py-1.5";
  const mono = `${cell} font-mono tabular-nums`;

  return (
    <tr
      draggable={joining}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", region.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!joining) return;
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onClick={onSelect}
      className={`cursor-default transition-colors ${
        selected
          ? "bg-primary/10 shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
          : "hover:bg-muted/40"
      } ${dropTarget ? "shadow-[inset_0_2px_0_0_hsl(var(--primary))]" : ""}`}
    >
      {joining && (
        <td className={`${cell} w-6`}>
          <button
            type="button"
            aria-label={`Move ${row.label}. Arrow keys move it up or down.`}
            title="Drag to move, or use the arrow keys"
            className="grid h-6 w-5 cursor-grab place-items-center text-muted-foreground hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                onShift(-1);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onShift(1);
              }
            }}
          >
            <GripGlyph />
          </button>
        </td>
      )}
      {joining && (
        <td className={`${mono} text-muted-foreground`}>{row.position}</td>
      )}
      <td className={cell}>
        <button
          type="button"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className="flex items-center gap-2 text-left font-medium"
        >
          <span
            className={`rounded px-1.5 py-px font-mono text-[10px] ${
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {row.number}
          </span>
          {row.label}
        </button>
      </td>
      <td className={mono}>{formatClock(region.start)}</td>
      <td className={mono}>{formatClock(region.end - region.start)}</td>
      <td className={mono}>{formatGain(region.gainDb)}</td>
      <td className={`${mono} text-muted-foreground`}>{formatFades(region)}</td>
      <td className={`${mono} text-muted-foreground`}>{formatStretch(region)}</td>
      {joining && (
        <td className={`${cell} py-1`}>
          {row.crossfadeMs === null ? (
            <span className="text-[11px] text-muted-foreground/60">first</span>
          ) : (
            <CrossfadeCell
              label={row.label}
              ms={row.crossfadeMs}
              onChange={onCrossfade}
            />
          )}
        </td>
      )}
      <td className={`${cell} w-8`}>
        <button
          type="button"
          aria-label={`Delete ${row.label}`}
          title="Delete this region (Ctrl+Z brings it back)"
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Cross2Icon />
        </button>
      </td>
    </tr>
  );
}

/**
 * The crossfade into one row: a pill that opens a slider. A seam with none is
 * a butt join, drawn dashed so it reads as "nothing here yet".
 */
function CrossfadeCell({
  label,
  ms,
  onChange,
}: {
  label: string;
  ms: number;
  onChange: (ms: number, gesture: number) => void;
}) {
  const [open, setOpen] = useState(false);
  // One drag is one undo entry. Letting go starts the next gesture.
  const [gesture, setGesture] = useState(0);

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        trigger={
          <button
            type="button"
            aria-label={`Crossfade into ${label}: ${ms > 0 ? `${ms} ms` : "none"}`}
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className={`h-6 min-w-[4rem] rounded-full px-2 font-mono text-[11px] ${
              ms > 0
                ? "border border-primary/50 bg-primary/10 text-red-300"
                : "border border-dashed border-border text-muted-foreground"
            }`}
          >
            {ms > 0 ? `${ms} ms` : "butt"}
          </button>
        }
      >
        <div className="flex w-64 flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs">
            <span>Crossfade into {label}</span>
            <code className="text-foreground">{ms > 0 ? `${ms} ms` : "none"}</code>
          </div>
          <Slider
            value={[ms]}
            min={0}
            max={MAX_CROSSFADE_MS}
            step={10}
            onValueChange={([next]) => onChange(next, gesture)}
            onValueCommit={() => setGesture((n) => n + 1)}
            aria-label={`Crossfade into ${label}`}
          />
          <p className="text-[11px] text-muted-foreground">
            Equal-power overlap. Capped at half of either region when the file
            is made.
          </p>
        </div>
      </Popover>
    </div>
  );
}
