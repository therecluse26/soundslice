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
import { FileType, useAudioStore } from "@/stores/audio-store";

const MasterToolbar = () => {
  const {
    compressFiles,
    setCompressFiles,
    normalizeAudio,
    setNormalizeAudio,
    exportFileType,
    setExportFileType,
  } = useAudioStore();

  // Get fileTypes from the store enum
  const fileTypes = Object.keys(FileType).map((key, value) => ({
    name: key,
    value: value,
  }));

  const handleNormalizeChange = (checked: boolean) => {
    setNormalizeAudio(checked);
  };

  const handleCompressChange = (checked: boolean) => {
    setCompressFiles(checked);
  };

  const handleExportFiles = () => {
    // Implement export functionality here
    console.log("Exporting all files...");
    console.log("Normalize audio:", normalizeAudio);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Control Panel</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between space-x-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="normalize-audio"
              checked={normalizeAudio}
              onCheckedChange={handleNormalizeChange}
            />
            <Label htmlFor="normalize-audio">Normalize Audio</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="compress-audio-files"
              checked={compressFiles}
              onCheckedChange={handleCompressChange}
            />
            <Label htmlFor="compress-audio-files">Compress File Size</Label>
          </div>
          <Select onValueChange={setExportFileType} value={exportFileType}>
            <SelectTrigger className="w-[400px]">
              <SelectValue placeholder="Export file Type" />
            </SelectTrigger>
            <SelectContent>
              {fileTypes.map((fileType) => (
                <SelectItem key={fileType.value} value={fileType.value.toString()}>
                  {fileType.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleExportFiles}>Export All Files</Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MasterToolbar;
