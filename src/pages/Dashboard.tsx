import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { EditorTrack, useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";
import SineWaveLoader from "@/components/custom/SineWaveLoader";
import { AdvancedSettingsChip } from "@/components/custom/AdvancedSettingsChip";
import { RefusedFilesNotice } from "@/components/custom/RefusedFilesNotice";
import { SliceProgressLabel } from "@/components/custom/SliceProgressLabel";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { countRender } from "@/lib/render-count";

export default function Dashboard() {
  if (import.meta.env.DEV) countRender("Dashboard");

  // Once for the whole page. One history serves the whole project, so one
  // listener serves it — a listener per card would undo once per card.
  useUndoRedo();

  /**
   * Subscribes to the **files**, not the tracks.
   *
   * A `File` object is kept across a merge, so this list stays shallow-equal
   * when a region changes. Dashboard therefore does not redraw when the user
   * drags a region — only the card that owns it does.
   */
  const files = useAudioStore(
    useShallow((state) => state.tracks.map((track) => track.file))
  );
  const isLoading = useAudioStore((state) => state.processingLoading);
  const setTracks = useAudioStore((state) => state.setTracks);

  const updateTrackCallback = useCallback(
    (tracks: EditorTrack[]) => {
      // No forced redraw. `setTracks` writes real state, so Zustand notifies
      // whoever is subscribed and nobody else.
      setTracks(tracks);
    },
    [setTracks]
  );

  return (
    <>
      <div className="flex-grow flex flex-col">
        <div className="container px-4 md:px-8 flex-grow flex flex-col">
          <div>
            <BrowserMultiFileUpload onUploadComplete={updateTrackCallback} />
            <RefusedFilesNotice />
            {files.length > 0 && (
              <div>
                <AdvancedSettingsChip />
                <MasterToolbar />
                {files.map((file) => (
                  <div key={file.name} className={"my-4"}>
                    <AudioEditor file={file} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
        The loader covers the page. It does not replace it.

        Replacing it unmounted `BrowserMultiFileUpload`, which came back with
        empty state and cleared every track. Replacing it also destroyed every
        wavesurfer instance, so each export paid to decode every file again.
        See `.wayfinder/tickets/016-export-empties-track-list.md`.

        The overlay sits above the page, so it takes the pointer events the
        page would otherwise get.
      */}
      {isLoading && (
        <div
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ backgroundColor: "hsl(var(--background) / 0.85)" }}
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">
            Slicing Audio. This may take a while...
          </span>
          <SineWaveLoader
            message="Slicing Audio. This may take a while..."
            messageFont="ui-sans-serif, system-ui, sans-serif"
            messageFontSize={32}
            color="#dc2626"
            textColor="#fafafa"
            lineThickness={8}
            sideFade={600}
            amplitude={0.1}
            frequency={0.015}
          />

          {/*
            The progress line sits outside `SineWaveLoader`, and it subscribes
            to the store itself. The loader draws to a canvas and takes its
            message as a prop, so feeding it a string that changes many times a
            second would restart the animation on every tick.
          */}
          <div className="pointer-events-none absolute inset-x-0 bottom-1/3">
            <SliceProgressLabel />
          </div>
        </div>
      )}
    </>
  );
}
