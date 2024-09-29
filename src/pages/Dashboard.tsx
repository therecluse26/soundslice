import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useCallback } from "react";

import { EditorTrack, useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";

export default function Dashboard() {
  const { tracks: files, setFiles } = useAudioStore();

  const updateFiles = useCallback((files: EditorTrack[]) => {
    console.log("Updating files...", files);
    setFiles(files);
  }, []);

  return (
    <>
      <div>
        <BrowserMultiFileUpload onUploadComplete={updateFiles} />
        {files.length > 0 && (
          <div>
            <MasterToolbar />
            {files.map((file, index) => (
              <div key={index} className={"my-4"}>
                <AudioEditor track={file} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
