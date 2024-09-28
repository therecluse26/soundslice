import BrowserMultiFileUpload from "@/components/custom/BrowserMultiFileUpload";
import { AudioEditor } from "@/components/custom/AudioEditor";
import { PageHeader, PageHeaderHeading } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCallback, useState } from "react";

export default function Dashboard() {
  const [files, setFiles] = useState<File[]>([]);

  const updateFiles = useCallback((files: File[]) => {
    setFiles(files);
  }, []);

  return (
    <>
      <div>
        <BrowserMultiFileUpload onUploadComplete={updateFiles} />
        {files.length > 0 && (
          <div>
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
