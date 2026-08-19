import { useAudioStore } from "@/stores/audio-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { ADVANCED_MEDIA_QUERY, View } from "@/lib/view";
import { cn } from "@/lib/utils";

const OPTIONS: { value: View; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "advanced", label: "Advanced" },
];

/**
 * Switches between Simple view and Advanced view.
 *
 * Not `ModeToggle`. That name is taken by the theme toggle at
 * `src/components/mode-toggle.tsx`, and `mode` means theme in this codebase.
 *
 * Hidden below 800 px, because Advanced view cannot be shown there. Hiding the
 * control does not change the stored view.
 */
export function ViewToggle() {
  const view = useAudioStore((state) => state.view);
  const setView = useAudioStore((state) => state.setView);
  const screenIsWideEnough = useMediaQuery(ADVANCED_MEDIA_QUERY);

  if (!screenIsWideEnough) return null;

  return (
    <div
      role="group"
      aria-label="View"
      className="flex items-center rounded-md border border-border p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setView(option.value)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
