import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioStore } from "@/stores/audio-store";
import { OutputFormat, AudioService } from "@/lib/audio-service";
import { DownloadIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useMediaQuery } from "@/lib/use-media-query";

const MasterToolbar = () => {
  const {
    tracks,
    normalizeAudio,
    setNormalizeAudio,
    applyPostProcessing,
    setApplyPostProcessing,
    trimSilence,
    setTrimSilence,
    exportFileType,
    setExportFileType,
  } = useAudioStore();

  const [downloading, setDownloading] = useState(false);

  const isMobile = useMediaQuery("(max-width: 800px)");

  const handleExportFiles = async () => {
    setDownloading(true);

    const respUrl = await AudioService.sliceAllFilesIntoZip(
      tracks,
      normalizeAudio.current,
      applyPostProcessing.current,
      trimSilence.current,
      exportFileType.current
    );

    const link = document.createElement("a");
    link.style.display = "none";
    link.href = respUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloading(false);
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
          <div className="flex flex-col w-full space-y-2">
            <Label className="w-full">Normalize Levels?</Label>
            <Select
              onValueChange={(checked) => {
                setNormalizeAudio(checked === "true");
              }}
              defaultValue={normalizeAudio.current.toString()}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"true"}>Yes</SelectItem>
                <SelectItem value={"false"}>No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col w-full space-y-2">
            <Label className="w-full">Apply Post Processing?</Label>
            <Select
              onValueChange={(checked) => {
                setApplyPostProcessing(checked === "true");
              }}
              defaultValue={applyPostProcessing.current.toString()}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"true"}>Yes</SelectItem>
                <SelectItem value={"false"}>No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col w-full space-y-2">
            <Label className="w-full">Trim Silence?</Label>
            <Select
              onValueChange={(checked) => {
                setTrimSilence(checked === "true");
              }}
              defaultValue={trimSilence.current.toString()}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"true"}>Yes</SelectItem>
                <SelectItem value={"false"}>No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col w-full space-y-2">
            <Label className="w-full">Output Format</Label>
            <Select
              onValueChange={setExportFileType}
              defaultValue={exportFileType.current}
            >
              <SelectTrigger className="w-full">
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

          <div className="flex w-full">
            {downloading ? (
              <Button
                disabled
                className="flex-grow h-full flex items-center justify-center w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary-foreground hover:text-primary"
              >
                <ReloadIcon className="animate-spin mr-2" />
                <span>{isMobile ? "Downloading..." : "Slice All Files"}</span>
              </Button>
            ) : (
              <Button
                onClick={handleExportFiles}
                className="flex-grow h-full flex items-center justify-center w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary-foreground hover:text-primary"
              >
                <DownloadIcon className="mr-2" />
                <span>{isMobile ? "Export All" : "Slice All Files"}</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MasterToolbar;
