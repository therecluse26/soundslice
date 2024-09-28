import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Cross1Icon, UploadIcon, FileIcon } from "@radix-ui/react-icons";
import { AudioFile } from "@/stores/audio-store";

interface FileUpload {
  file: File;
  progress: number;
  isComplete: boolean;
}

interface BrowserMultiFileUploadProps {
  onUploadComplete?: (files: AudioFile[]) => void;
}

export default function BrowserMultiFileUpload({
  onUploadComplete,
}: BrowserMultiFileUploadProps) {
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCompleteRef = useRef(false);
  const [isUploadComplete, setIsUploadComplete] = useState(false);

  useEffect(() => {
    if (
      onUploadComplete &&
      !isUploadComplete &&
      uploads.every((upload) => upload.isComplete)
    ) {
      setIsUploadComplete(true);
      onUploadComplete(uploads.map((upload) => {
        return {
          file: upload.file,
        } as AudioFile;
      }));
    }
  }, [uploads, onUploadComplete, isUploadComplete]);

  const uploadFile = useCallback((file: File) => {
    return new Promise<void>((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 40;
        setUploads((prev) =>
          prev.map((upload) =>
            upload.file === file ? { ...upload, progress } : upload
          )
        );
        if (progress >= 100) {
          clearInterval(interval);
          setUploads((prev) =>
            prev.map((upload) =>
              upload.file === file ? { ...upload, isComplete: true } : upload
            )
          );
          resolve();
        }
      }, 100);
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
        }
      }
    },
    [uploadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        handleFiles(droppedFiles);
      }
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      handleFiles(files);
    },
    [handleFiles]
  );

  const removeUpload = useCallback((file: File) => {
    setUploads((prev) => prev.filter((upload) => upload.file !== file));
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="w-full max-w-md mx-auto p-4">
      <div>
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className="mx-auto h-12 w-12" />
          <p className="mt-2 text-sm">
            Drag and drop files here, or click to select files
          </p>
        </div>
        <input
          type="file"
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
              <Card key={index}>
                <CardContent className="py-4">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center">
                      <FileIcon className="h-4 w-4 mr-2" />
                      <span className="text-sm font-medium truncate">
                        {upload.file.name}
                      </span>
                    </div>
                  </div>
                  <Progress value={upload.progress} className="w-full" />
                </CardContent>
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
