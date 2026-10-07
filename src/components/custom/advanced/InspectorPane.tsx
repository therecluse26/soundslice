import { useMediaQuery } from "@/lib/use-media-query";
import { InspectorTab, useWorkspace } from "@/stores/workspace";
import { FileOutGlyph, PanelRightGlyph, SlidersGlyph } from "./glyphs";

/**
 * Advanced view's right-hand pane: the **inspector**, empty of its own.
 *
 * The open track's card fills it through a portal — the card owns the preview
 * whose meters the chain draws, so the card must render what reads them. This
 * pane only says where, and offers the collapse.
 *
 * On a screen too narrow for three panes it floats over the waveform rather
 * than squeezing it. Collapsed, it is a rail: one button per tab.
 */
export default function InspectorPane() {
  const collapsed = useWorkspace((state) => state.collapsed.inspector);
  const toggle = useWorkspace((state) => state.toggleCollapsed);
  const tab = useWorkspace((state) => state.inspectorTab);
  const setTab = useWorkspace((state) => state.setInspectorTab);
  const setElement = useWorkspace((state) => state.setInspectorElement);
  const roomy = useMediaQuery("(min-width: 1180px)");

  if (collapsed) {
    const open = (next: InspectorTab) => {
      setTab(next);
      toggle("inspector");
    };

    return (
      <aside
        aria-label="Track settings"
        className="flex h-full w-[52px] shrink-0 flex-col items-center gap-2 border-l border-border bg-muted/10 py-3"
      >
        <RailButton label="Show the track settings" onClick={() => toggle("inspector")}>
          <PanelRightGlyph open={false} />
        </RailButton>
        <span className="my-1 h-px w-6 bg-border" />
        <RailButton label="Sound" active={tab === "sound"} onClick={() => open("sound")}>
          <SlidersGlyph />
        </RailButton>
        <RailButton label="Export" active={tab === "export"} onClick={() => open("export")}>
          <FileOutGlyph />
        </RailButton>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Track settings"
      className={`flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-background ${
        roomy ? "" : "absolute right-0 top-0 z-30 shadow-2xl"
      }`}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Track settings
        </span>
        <RailButton label="Collapse the track settings" small onClick={() => toggle("inspector")}>
          <PanelRightGlyph open />
        </RailButton>
      </div>
      <div ref={setElement} className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" />
    </aside>
  );
}

function RailButton({
  label,
  onClick,
  small = false,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  small?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid place-items-center rounded border hover:border-foreground/40 hover:text-foreground ${
        active ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground"
      } ${small ? "h-7 w-7" : "h-8 w-8"}`}
    >
      {children}
    </button>
  );
}
