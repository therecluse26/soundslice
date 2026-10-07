import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAudioStore } from "@/stores/audio-store";
import { downloadBlob } from "@/lib/download";
import {
  PROJECT_FILE_EXTENSION,
  projectFile,
  readProjectFile,
} from "@/lib/saved-project";

/**
 * **Save project** and **Open project** — the work on every track, as a
 * `.soundslice.json` file. Ticket 038.
 *
 * Autosave already keeps each file's work in this browser. This is for keeping
 * it for good, or moving it to another machine. The file holds no audio: open
 * it with the same files loaded, and each track gets its work back. Opening is
 * one gesture, so Ctrl+Z undoes it.
 *
 * Advanced view only, inside the master toolbar's lazy block.
 */
export function ProjectFile() {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hasTracks = useAudioStore((state) => state.tracks.length > 0);

  const save = () => {
    const text = projectFile(useAudioStore.getState().tracks);
    downloadBlob(
      new Blob([text], { type: "application/json" }),
      `soundslice-project${PROJECT_FILE_EXTENSION}`
    );
    setMessage(null);
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    const project = readProjectFile(await file.text());

    if (!project) {
      setMessage(
        "That is not a SoundSlice project this version can read. Nothing was changed."
      );
      return;
    }

    const { applied, missing } = useAudioStore.getState().openProject(project);
    setMessage(
      applied.length === 0
        ? "None of its files are loaded. Load them, then open the project again."
        : `Opened ${applied.length} ${applied.length === 1 ? "track" : "tracks"}.` +
            (missing.length > 0 ? ` Not loaded: ${missing.join(", ")}.` : "")
    );
  };

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Project</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={!hasTracks}
          onClick={save}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={!hasTracks}
          onClick={() => input.current?.click()}
        >
          Open
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Open project file"
          onChange={(event) => {
            void open(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {message && <p className="text-[11px] text-muted-foreground">{message}</p>}
    </div>
  );
}
