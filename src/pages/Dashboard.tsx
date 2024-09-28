import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { useCallback } from "react";

import { AudioFile, useAudioStore } from "@/stores/audio-store";
import MasterToolbar from "@/components/custom/MasterToolbar";

export default function Dashboard() {
  const { files, setFiles } = useAudioStore();

  const updateFiles = useCallback((files: AudioFile[]) => {
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
                <AudioEditor file={file} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
