import { useRef, useState } from "react";
import { ChevronLeftGlyph, ChevronRightGlyph } from "./glyphs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useAudioStore } from "@/stores/audio-store";
import { Region, regionLabel } from "@/lib/edit-stack";
import {
  JoinLayout,
  crossfadeInto,
  isJoinReordered,
  joinOrdered,
} from "@/lib/track-work";
import {
  moveInJoin,
  shiftInJoin,
  withCrossfade,
  withStartTimeOrder,
} from "@/lib/join-layout";

/** The longest crossfade the strip offers, in milliseconds. */
const MAX_CROSSFADE_MS = 2000;

/**
 * **The join strip** — this track's regions in the order a join plays them,
 * with the seam between each pair. Advanced view only. Ticket 034.
 *
 * Shown only while **Join** is on. With join off there is no order to set and
 * no seam to fade: every region is its own file.
 *
 * - **Order.** Drag a region onto another to take its place, or use the arrows.
 *   **Reset order** goes back to start-time order and keeps the crossfades.
 * - **Seams.** Each seam is a butt join until it is given a crossfade. A
 *   crossfade overlaps the two regions by that many milliseconds with an
 *   equal-power curve, and replaces both regions' own fades at that seam. It is
 *   stored on the region *after* the seam, so it moves with that region.
 *
 * A crossfade is capped, when the file is made, at half the shorter of its two
 * regions — so a region can never be faded over from both sides and vanish.
 */
export function JoinStrip({ fileName }: { fileName: string }) {
  const joinMode = useAudioStore((state) => state.joinMode);
  const regions = useAudioStore(
    (state) => state.tracks.find((t) => t.file.name === fileName)?.regions
  );
  const layout = useAudioStore(
    (state) => state.tracks.find((t) => t.file.name === fileName)?.join
  );
  const setJoin = useAudioStore((state) => state.setTrackJoinLayout);

  const dragging = useRef<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  // One drag of one seam's slider is one undo entry. Letting go bumps it.
  const [gesture, setGesture] = useState(0);

  if (joinMode === "separate" || !regions) return null;

  const write = (next: JoinLayout | undefined, label: string, key?: string) =>
    setJoin(fileName, next, { label, coalesceKey: key });

  const ordered = joinOrdered(regions, layout);

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Join order</Label>
        {isJoinReordered(regions, layout) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => write(withStartTimeOrder(layout), "Reset join order")}
          >
            Reset order
          </Button>
        )}
      </div>

      {ordered.length < 2 ? (
        <p className="text-xs text-muted-foreground">
          {ordered.length === 0
            ? "No regions — this track adds nothing to the join."
            : "One region — there is nothing to join it to."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {ordered.map((region, index) => (
            <li key={region.id} className="flex flex-col gap-1">
              {index > 0 && (
                <Seam
                  ms={crossfadeInto(layout, region.id)}
                  onChange={(ms) =>
                    write(
                      withCrossfade(layout, region.id, ms),
                      "Crossfade",
                      `crossfade:${fileName}:${region.id}:${gesture}`
                    )
                  }
                  onCommit={() => setGesture((n) => n + 1)}
                />
              )}

              <JoinChip
                label={regionLabel(regions, region)}
                region={region}
                first={index === 0}
                last={index === ordered.length - 1}
                dropTarget={dropOn === region.id}
                onShift={(delta) =>
                  write(
                    shiftInJoin(regions, layout, region.id, delta),
                    "Reorder join"
                  )
                }
                onDragStart={() => {
                  dragging.current = region.id;
                }}
                onDragEnd={() => {
                  dragging.current = null;
                  setDropOn(null);
                }}
                onDragOver={() => {
                  if (dragging.current && dragging.current !== region.id) {
                    setDropOn(region.id);
                  }
                }}
                onDrop={() => {
                  const moved = dragging.current;
                  dragging.current = null;
                  setDropOn(null);
                  if (!moved) return;
                  write(
                    moveInJoin(regions, layout, moved, region.id),
                    "Reorder join"
                  );
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function JoinChip({
  label,
  region,
  first,
  last,
  dropTarget,
  onShift,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  label: string;
  region: Region;
  first: boolean;
  last: boolean;
  dropTarget: boolean;
  onShift: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={`flex cursor-grab items-center gap-2 rounded border px-2 py-1 text-xs ${
        dropTarget ? "border-primary bg-primary/10" : "border-border"
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      <code className="text-muted-foreground">
        {formatSeconds(region.start)}–{formatSeconds(region.end)}
      </code>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        disabled={first}
        aria-label={`Move ${label} earlier`}
        onClick={() => onShift(-1)}
      >
        <ChevronLeftGlyph />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        disabled={last}
        aria-label={`Move ${label} later`}
        onClick={() => onShift(1)}
      >
        <ChevronRightGlyph />
      </Button>
    </div>
  );
}

function Seam({
  ms,
  onChange,
  onCommit,
}: {
  ms: number;
  onChange: (ms: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-3 pl-4">
      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
        {ms > 0 ? "Crossfade" : "Butt join"}
      </span>
      <Slider
        value={[ms]}
        min={0}
        max={MAX_CROSSFADE_MS}
        step={10}
        onValueChange={([next]) => onChange(next)}
        onValueCommit={onCommit}
        aria-label="Crossfade"
      />
      <code className="w-16 shrink-0 text-right text-[11px] text-primary">
        {ms > 0 ? `${ms} ms` : "—"}
      </code>
    </div>
  );
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${rest}`;
}
