import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useShallow } from "zustand/react/shallow";

import { useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";
import SineWaveLoader from "@/components/custom/SineWaveLoader";
import { AdvancedSettingsChip } from "@/components/custom/AdvancedSettingsChip";
import { RefusedFilesNotice } from "@/components/custom/RefusedFilesNotice";
import { SliceProgressLabel } from "@/components/custom/SliceProgressLabel";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { countRender } from "@/lib/render-count";
import { Button } from "@/components/ui/button";
import { Suspense, lazy, useEffect } from "react";
import { useEffectiveView } from "@/hooks/useEffectiveView";
import { openTrackName, useWorkspace } from "@/stores/workspace";

// Advanced view's two side panes. Standing rule 6: a Simple view user never
// downloads either.
const TrackSidebar = lazy(() => import("@/components/custom/advanced/TrackSidebar"));
const InspectorPane = lazy(() => import("@/components/custom/advanced/InspectorPane"));

export default function Dashboard() {
  if (import.meta.env.DEV) countRender("Dashboard");

  // Once for the whole page. One history serves the whole project, so one
  // listener serves it — a listener per card would undo once per card.
  useUndoRedo();

  // Saved projects. Started once, for the life of the page, from its own chunk
  // so Simple view's first paint does not wait for it. Ticket 038.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let live = true;
    void import("@/lib/project-autosave").then(({ startAutosave }) => {
      if (live) stop = startAutosave();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);

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
  const cancelExport = useAudioStore((state) => state.cancelExport);
  // A store action is a stable reference, so the uploader never sees a new
  // callback and never re-runs anything because of one.
  const addFiles = useAudioStore((state) => state.addFiles);

  const fileNames = files.map((file) => file.name);
  const activeTrack = useWorkspace((state) => state.activeTrack);
  const openName = openTrackName(fileNames, activeTrack);

  /**
   * Advanced view is a **workspace** once there is a track: the track list,
   * one open track, and its settings. Before the first track it is the same
   * drop zone Simple view shows.
   *
   * **Every element keeps its place in the tree in both views.** Only class
   * names change, and the side panes are holes in Simple view. So switching
   * view never remounts a card, which would destroy its wavesurfer and decode
   * the file again, and never remounts the uploader mid-upload.
   *
   * Every card stays mounted in Advanced view; the ones not open are hidden.
   * Switching tracks is then instant, and each keeps its zoom and playhead.
   */
  const advanced = useEffectiveView() === "advanced" && files.length > 0;

  return (
    <>
      <div
        className={
          advanced
            ? "relative flex h-full min-h-0 w-full"
            : "flex-grow flex flex-col"
        }
      >
        {advanced && (
          <Suspense fallback={null}>
            <TrackSidebar fileNames={fileNames} openName={openName} />
          </Suspense>
        )}

        <div
          className={
            advanced
              ? "h-full min-w-0 flex-1 overflow-y-auto px-6 py-4"
              : "container px-4 md:px-8 flex-grow flex flex-col"
          }
        >
          <div>
            {/*
              Kept mounted while hidden: Advanced view's track list has its own
              small Add button, and unmounting this one would drop an upload
              that is still reading.
            */}
            <div className={advanced ? "hidden" : undefined}>
              <BrowserMultiFileUpload onFilesReady={addFiles} />
            </div>
            <RefusedFilesNotice />
            {files.length > 0 && (
              <div>
                {!advanced && <AdvancedSettingsChip />}
                {!advanced && <MasterToolbar />}
                {files.map((file) => {
                  const open = !advanced || file.name === openName;
                  return (
                    <div
                      key={file.name}
                      className={advanced ? (open ? undefined : "hidden") : "my-4"}
                    >
                      <AudioEditor file={file} open={open} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {advanced && (
          <Suspense fallback={null}>
            <InspectorPane />
          </Suspense>
        )}
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
          <div className="absolute inset-x-0 bottom-1/3 flex flex-col items-center gap-4">
            <div className="pointer-events-none">
              <SliceProgressLabel />
            </div>
            {/*
              The one way out of a long export. It stops at the next render
              pass or encode chunk, and nothing downloads. Ticket 035.
            */}
            <Button variant="outline" onClick={cancelExport}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
