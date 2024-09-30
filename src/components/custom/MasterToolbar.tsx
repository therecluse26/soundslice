import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioStore } from "@/stores/audio-store";
import { OutputFormat } from "@/lib/audio-service";
import { DownloadIcon } from "@radix-ui/react-icons";
import { useMediaQuery } from "@/lib/use-media-query";

const MasterToolbar = () => {
  const {
    normalizeAudio,
    setNormalizeAudio,
    exportFileType,
    setExportFileType,
  } = useAudioStore();

  const isMobile = useMediaQuery("(max-width: 800px)");

  const handleNormalizeChange = (checked: boolean) => {
    setNormalizeAudio(checked);
  };

  const handleExportFiles = () => {
    console.log("Exporting all files...");
    console.log("Normalize audio:", normalizeAudio);
    console.log("Export file type:", exportFileType);
  };

  return (
    <Card>
      <CardContent className="mt-6">
        <div
          className={`flex flex-col space-y-4 ${
            isMobile
              ? "flex-col justify-center items-center w-full"
              : "sm:flex-row sm:justify-center gap-8 sm:space-x-2 sm:space-y-0"
          }`}
        >
          <div className="flex items-center space-x-2">
            <Label>Normalize Audio?</Label>
            <Checkbox
              checked={normalizeAudio}
              onCheckedChange={handleNormalizeChange}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Label>Output Format</Label>
            <Select
              onValueChange={setExportFileType}
              defaultValue={exportFileType}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  key={`filetype_${OutputFormat.WAV.toString()}`}
                  value={OutputFormat.WAV.toString()}
                >
                  {OutputFormat.WAV}
                </SelectItem>
                <SelectItem
                  key={`filetype_${OutputFormat.MP3.toString()}`}
                  value={OutputFormat.MP3.toString()}
                >
                  {OutputFormat.MP3}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleExportFiles}
            className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary-foreground hover:text-primary"
          >
            <DownloadIcon />
            <span className="ml-2">
              {isMobile ? "Export All" : "Slice & Download All Files"}
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MasterToolbar;
