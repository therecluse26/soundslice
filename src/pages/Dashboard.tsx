import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useCallback, useEffect, useState } from "react";

import { EditorTrack, useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";
import SineWaveLoader from "@/components/custom/SineWaveLoader";
import { Header } from "@/components/layouts/Header";
import { Footer } from "@/components/layouts/Footer";

export default function Dashboard() {
  const [isLoading, setIsLoading] = useState(false);
  const { tracks, setTracks, triggerRerender, processingLoading } =
    useAudioStore();

  const updateTrackCallback = useCallback((tracks: EditorTrack[]) => {
    setTracks(tracks);
    // trigger re-render, dumb hack to work around updating above refs, but it works
    triggerRerender();
  }, []);

  useEffect(() => {
    setIsLoading(processingLoading);
  }, [processingLoading]);

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
            </div>
          </div>
        </>
      )}
    </>
  );
}
