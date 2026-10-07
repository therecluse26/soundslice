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
