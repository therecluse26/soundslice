import React, { useState, useCallback, useRef, useEffect } from "react";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { UploadIcon, FileIcon } from "@radix-ui/react-icons";
import { EditorTrack } from "@/stores/audio-store";

interface FileUpload {
  file: File;
  progress: number;
  isComplete: boolean;
  error?: string;
}

interface BrowserMultiFileUploadProps {
  onUploadComplete?: (tracks: EditorTrack[]) => void;
}

export default function BrowserMultiFileUpload({
  onUploadComplete,
}: BrowserMultiFileUploadProps) {
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCompleteRef = useRef(false);
  const [isUploadComplete, setIsUploadComplete] = useState(false);
  const [dragDropError, setDragDropError] = useState<string | null>(null);

  useEffect(() => {
    if (
      onUploadComplete &&
      !isUploadComplete &&
      uploads.every((upload) => upload.isComplete)
    ) {
      setIsUploadComplete(true);
      onUploadComplete(
        uploads.map((upload) => {
          return {
            file: upload.file,
          } as EditorTrack;
        })
      );
    }
  }, [uploads, onUploadComplete, isUploadComplete]);

  const uploadFile = useCallback((file: File) => {
    setDragDropError(null); // Reset error state

    return new Promise<void>((resolve, reject) => {
      // Create a new File object to ensure we have a fresh reference
      const freshFile = new File([file], file.name, { type: file.type });

      const reader = new FileReader();

      reader.onload = (event) => {
        // Simulate upload process
        let progress = 0;
        const interval = setInterval(() => {
          progress += 20;
          setUploads((prev) =>
            prev.map((upload) =>
              upload.file.name === freshFile.name
                ? { ...upload, progress }
                : upload
            )
          );
          if (progress >= 100) {
            clearInterval(interval);
            setUploads((prev) =>
              prev.map((upload) =>
                upload.file.name === freshFile.name
                  ? { ...upload, isComplete: true }
                  : upload
              )
            );
            resolve();
          }
        }, 100);
      };

      reader.onerror = (event) => {
        console.error(`FileReader error for ${freshFile.name}:`, reader.error);
        reject(
          new Error(
            `FileReader error: ${reader.error?.message || "Unknown error"}`
          )
        );
      };

      try {
        reader.readAsArrayBuffer(freshFile);
      } catch (error) {
        console.error(`Error starting file read for ${freshFile.name}:`, error);
        if (error instanceof Error) {
          reject(new Error(`Failed to start file read: ${error.message}`));
        } else {
          reject(new Error("Failed to start file read: Unknown error"));
        }
      }
    });
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setIsUploadComplete(false);
      if (files.length === 0) {
        console.error("No files received");
        return;
      }

      const newUploads = files.map((file) => ({
        file,
        progress: 0,
        isComplete: false,
      }));
      setUploads((prev) => [...prev, ...newUploads]);

      for (const upload of newUploads) {
        try {
          await uploadFile(upload.file);
        } catch (error) {
          console.error(`Error uploading file ${upload.file.name}:`, error);
          setUploads((prev) =>
            prev.map((u) =>
              u.file.name === upload.file.name
                ? {
                    ...u,
                    isComplete: true,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }
                : u
            )
          );
        }
      }
    },
    [uploadFile]
  );

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      setDragDropError(null); // Reset error state

      try {
        const dt = e.dataTransfer;

        if (!dt || !dt.files || dt.files.length === 0) {
          throw new Error("No files detected in the drop event.");
        }

        const droppedFiles = Array.from(dt.files).filter((file) =>
          file.type.includes("audio")
        );

        if (droppedFiles.length > 0) {
          if (droppedFiles[0].size === 0) {
            throw new Error(
              "File size is 0, which may indicate a browser compatibility issue."
            );
          }
          handleFiles(droppedFiles);
        } else {
          setDragDropError("No valid audio files were dropped.");
          return;
        }
      } catch (error) {
        console.error("Error in drag and drop:", error);
        setDragDropError(
          "Your browser might not support file drag and dropping. Please click here to use your browser's built-in upload dialog."
        );
      }
    },
    [handleFiles]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      handleFiles(files);
    },
    [handleFiles]
  );

  return (
    <div className="w-full max-w-md mx-auto p-4">
      <div>
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className="mx-auto h-12 w-12" />
          <p className="mt-2 text-sm">
            Drag and drop audio files here, or click to select files
          </p>
          {dragDropError && (
            <div style={{ color: "red", marginTop: "10px" }}>
              {dragDropError}
            </div>
          )}
        </div>
        <input
          type="file"
          accept="audio/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileChange}
          multiple
          aria-label="File upload"
        />
      </div>
      <div className="mt-4 space-y-4">
        {uploads.map((upload, index) => (
          <div key={index}>
            {!upload.isComplete && (
              <Card>
                <CardContent className="py-4">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center">
                      <FileIcon className="h-4 w-4 mr-2" />
                      <span className="text-sm font-medium truncate text-wrap break-all">
                        {upload.file.name}
                      </span>
                    </div>
                  </div>
                  <Progress value={upload.progress} className="w-full" />
                  {upload.error && (
                    <p className="text-red-500 text-sm mt-2">{upload.error}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
