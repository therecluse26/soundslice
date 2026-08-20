import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { METER_FLOOR_DB, meterFraction } from "@/lib/meter";
import { METER_COLORS, METER_ZONES } from "@/lib/meter-canvas";

/**
 * The small controls Advanced view's two strips share.
 *
 * They were written inside `RegionToolbar` and the signal chain needed the same
 * three. One copy, so the region tools and the sound blocks cannot drift into
 * looking like two different applications.
 *
 * Advanced view only, and reached only through lazy-loaded parents. Standing
 * rule 6.
 */

export function ToolButton({
  children,
  pressed,
  title,
  onClick,
}: {
  children: React.ReactNode;
  pressed?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={`flex h-7 items-center rounded border px-2 text-xs transition-colors ${
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-foreground hover:border-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function ToolSlider({
  label,
  display,
  value,
  range,
  onChange,
  onCommit,
}: {
  label: string;
  display: string;
  value: number;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
  /** Called when the pointer is let go. Ends a coalesced undo gesture. */
  onCommit?: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-28 shrink-0 text-xs">{label}</Label>
      <Slider
        value={[value]}
        min={range.min}
        max={range.max}
        step={range.step}
        onValueChange={([next]) => onChange(next)}
        onValueCommit={onCommit}
        aria-label={label}
      />
      <code className="w-20 shrink-0 text-right text-xs text-primary">
        {display}
      </code>
    </div>
  );
}

/**
 * A panel anchored under its trigger, closed by Escape or a click outside.
 *
 * Hand-written, and the reason is that this repo has no popover primitive and
 * one panel is not worth a dependency. `DropdownMenu` is installed and is the
 * wrong shape: a menu takes the keyboard for its own item navigation, and this
 * holds sliders.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const anchor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const outside = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onClose]);

  return (
    <div ref={anchor} className="relative">
      {trigger}
      {open && (
        <div className="absolute left-0 top-8 z-50 rounded border border-border bg-background p-3 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A level on the meter's own scale, with a marker where the value sits.
 *
 * The graphical answer for a control that is one number on a decibel scale — a
 * ceiling, a target, a threshold. It shows the same −60 to 0 the meters show,
 * in the same three colours, so "the limiter is here and the signal is there"
 * can be read off two pictures that agree.
 *
 * Plain elements, not a canvas. It never animates, so a canvas would cost a
 * context and a device-pixel-ratio dance for a picture that changes when the
 * user drags a slider and at no other time.
 */
export function ScaleStrip({
  fraction,
  label,
}: {
  /** Where the marker goes, from 0 at the left to 1 at the right. */
  fraction: number;
  label: string;
}) {
  return (
    <div className="mt-1">
      <div
        className="relative h-2 w-full overflow-hidden rounded-sm opacity-70"
        style={{ backgroundImage: ZONE_GRADIENT }}
      >
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground"
          style={{ left: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{METER_FLOOR_DB}</span>
        <span>{label}</span>
        <span>0 dBFS</span>
      </div>
    </div>
  );
}

/**
 * The three zones as a CSS gradient, computed from the same two numbers the
 * canvas meters use.
 *
 * Written out rather than hard-coded in a Tailwind arbitrary value, because a
 * copied `80%` would keep working after somebody moved `METER_ZONES.amberFromDb`
 * and the strip would quietly stop agreeing with the meter beside it.
 */
const ZONE_GRADIENT = (() => {
  const amber = (meterFraction(METER_ZONES.amberFromDb) * 100).toFixed(2);
  const red = (meterFraction(METER_ZONES.redFromDb) * 100).toFixed(2);

  return (
    `linear-gradient(to right,` +
    ` ${METER_COLORS.green} 0%, ${METER_COLORS.green} ${amber}%,` +
    ` ${METER_COLORS.amber} ${amber}%, ${METER_COLORS.amber} ${red}%,` +
    ` ${METER_COLORS.red} ${red}%, ${METER_COLORS.red} 100%)`
  );
})();
