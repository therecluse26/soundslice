import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useCallback } from "react";

import { EditorTrack, useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";

export default function Dashboard() {
  const { tracks, setTracks, triggerRerender } = useAudioStore();

  const updateTrackCallback = useCallback((tracks: EditorTrack[]) => {
    setTracks(tracks);
    // trigger re-render, dumb hack to work around updating above refs, but it works
    triggerRerender();
  }, []);

  return (
    <>
      <div>
        <BrowserMultiFileUpload onUploadComplete={updateTrackCallback} />
        {tracks.current.length > 0 && (
          <div>
            <MasterToolbar />
            {tracks.current.map((track, index) => (
              <div key={index} className={"my-4"}>
                <AudioEditor track={track} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
