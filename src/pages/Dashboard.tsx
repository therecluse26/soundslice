import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { EditorTrack, useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";
import SineWaveLoader from "@/components/custom/SineWaveLoader";
import { AdvancedSettingsChip } from "@/components/custom/AdvancedSettingsChip";
import { countRender } from "@/lib/render-count";

export default function Dashboard() {
  if (import.meta.env.DEV) countRender("Dashboard");

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
      {isLoading ? (
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
      ) : (
        <>
          <div className="flex-grow flex flex-col">
            <div className="container px-4 md:px-8 flex-grow flex flex-col">
              <div>
                <BrowserMultiFileUpload
                  onUploadComplete={updateTrackCallback}
                />
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
        </>
      )}
    </>
  );
}
