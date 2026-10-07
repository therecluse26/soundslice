import { MeterSource } from "@/lib/preview";
import { InspectorTab, useWorkspace } from "@/stores/workspace";
import { ExportOptions } from "./ExportOptions";
import { NarrowPanel } from "./narrow-panel";
import { SignalChain } from "./SignalChain";
import { FileOutGlyph, SlidersGlyph } from "./glyphs";

const TABS: { id: InspectorTab; label: string; Icon: typeof SlidersGlyph }[] = [
  { id: "sound", label: "Sound", Icon: SlidersGlyph },
  { id: "export", label: "Export", Icon: FileOutGlyph },
];

/**
 * **The inspector**: the open track's Sound and Export, in Advanced view's
 * right-hand pane.
 *
 * The open track's card draws this into that pane through a portal, so the
 * chain's meters stay wired to the card's own preview exactly as before — the
 * pane is only where it appears.
 *
 * **Two tabs, one open at a time.** These were two accordions under the card,
 * which grew the page past the next track. Regions are not here: the region
 * table under the waveform is their list, and a region's own gain, fades and
 * name are drawn on the region.
 *
 * **This file is the lazy-load boundary.** It is reached only through a dynamic
 * import in `AudioEditor`, so a Simple view user never downloads it. It must
 * have a default export, because `React.lazy` requires one.
 */
export default function AdvancedPanel({
  fileName,
  meters,
}: {
  fileName: string;
  meters: MeterSource;
}) {
  const tab = useWorkspace((state) => state.inspectorTab);
  const setTab = useWorkspace((state) => state.setInspectorTab);

  return (
    <NarrowPanel.Provider value={true}>
      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label="Track settings"
          className="flex rounded-md border border-border bg-muted/30 p-0.5"
        >
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`inspector-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="inspector-tabpanel"
              onClick={() => setTab(id)}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded text-xs transition-colors ${
                tab === id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="inspector-tabpanel"
          aria-labelledby={`inspector-tab-${tab}`}
        >
          {tab === "sound" ? (
            <SignalChain fileName={fileName} meters={meters} layout="column" />
          ) : (
            <ExportOptions fileName={fileName} />
          )}
        </div>
      </div>
    </NarrowPanel.Provider>
  );
}
