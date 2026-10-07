/**
 * Small line icons for Advanced view, drawn here rather than imported.
 *
 * `@radix-ui/react-icons` is **one module**, and a module cannot be split
 * between chunks. So every icon any lazy chunk imports from it is bundled into
 * the main chunk, beside the icons Simple view uses — four new icons cost
 * Simple view 5.6 KB it never draws. These live in the lazy chunks that use
 * them. Standing rule 6.
 *
 * 15 × 15, `currentColor`, to sit beside the Radix icons without a seam.
 */

type GlyphProps = { className?: string };

function Glyph({
  className,
  children,
}: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export function ChevronLeftGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9 3.5 5 7.5l4 4" />
    </Glyph>
  );
}

export function ChevronRightGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m6 3.5 4 4-4 4" />
    </Glyph>
  );
}

export function CopyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="5" y="5" width="7.5" height="7.5" rx="1" />
      <path d="M10 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1H5" />
    </Glyph>
  );
}

export function TimerGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="7.5" cy="8.5" r="4.5" />
      <path d="M7.5 8.5V6M6 2h3" />
    </Glyph>
  );
}

export function BoltGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8.5 1.5 3.5 8.5h4l-1 5 5-7h-4z" />
    </Glyph>
  );
}

/** Six dots: "drag me". */
export function GripGlyph(props: GlyphProps) {
  return (
    <svg width="10" height="15" viewBox="0 0 10 15" fill="currentColor" aria-hidden className={props.className}>
      <circle cx="3" cy="3.5" r="1.1" />
      <circle cx="7" cy="3.5" r="1.1" />
      <circle cx="3" cy="7.5" r="1.1" />
      <circle cx="7" cy="7.5" r="1.1" />
      <circle cx="3" cy="11.5" r="1.1" />
      <circle cx="7" cy="11.5" r="1.1" />
    </svg>
  );
}

/** A panel on the left edge; the chevron points the way it will move. */
export function PanelLeftGlyph({ open, ...props }: GlyphProps & { open: boolean }) {
  return (
    <Glyph {...props}>
      <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" />
      <path d="M5.5 2.5v10" />
      <path d={open ? "m10 6-1.5 1.5L10 9" : "m8.5 6 1.5 1.5L8.5 9"} />
    </Glyph>
  );
}

/** A panel on the right edge; the chevron points the way it will move. */
export function PanelRightGlyph({ open, ...props }: GlyphProps & { open: boolean }) {
  return (
    <Glyph {...props}>
      <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" />
      <path d="M9.5 2.5v10" />
      <path d={open ? "m5 6 1.5 1.5L5 9" : "m6.5 6L5 7.5 6.5 9"} />
    </Glyph>
  );
}

/** Three faders: the Sound tab. */
export function SlidersGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 13V8M3 5V2M7.5 13V9.5M7.5 6.5V2M12 13V7M12 4V2" />
      <path d="M1.5 6.5h3M6 8h3M10.5 5.5h3" />
    </Glyph>
  );
}

/** A page with an arrow out of it: the Export tab. */
export function FileOutGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8.5 1.5H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5z" />
      <path d="M8.5 1.5V5H12M7.5 7v4M5.5 9.5l2 2 2-2" />
    </Glyph>
  );
}

/** Lines merging into one: the join order. */
export function JoinGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2 4h5l3 3.5M2 11h5l3-3.5h3.5" />
      <path d="m11.5 5.5 2 2-2 2" />
    </Glyph>
  );
}
