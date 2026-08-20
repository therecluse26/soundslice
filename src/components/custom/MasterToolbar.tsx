import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { masterExportSettings, useAudioStore } from "@/stores/audio-store";
import { AudioService } from "@/lib/audio-service";
import {
  ADVANCED_FORMATS,
  FORMAT_LABEL,
  OutputFormat,
  SIMPLE_FORMATS,
  needsWebCodecs,
} from "@/lib/output-format";
import { canEncodeOpus } from "@/lib/encode-capabilities";
import { downloadBlob } from "@/lib/download";
import { DownloadIcon, QuestionMarkCircledIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useMediaQuery } from "@/lib/use-media-query";
import { useEffectiveView } from "@/hooks/useEffectiveView";
import { countRender } from "@/lib/render-count";

const MasterToolbar = () => {
  if (import.meta.env.DEV) countRender("MasterToolbar");

  // One selector per setting, so this toolbar redraws when a master default
  // changes and the track cards do not. `tracks` is deliberately not selected:
  // the export handler reads it once, at click time, from `getState()`.
  const normalizeAudio = useAudioStore((state) => state.normalizeAudio);
  const setNormalizeAudio = useAudioStore((state) => state.setNormalizeAudio);
  const applyPostProcessing = useAudioStore(
    (state) => state.applyPostProcessing
  );
  const setApplyPostProcessing = useAudioStore(
    (state) => state.setApplyPostProcessing
  );
  const exportFileType = useAudioStore((state) => state.exportFileType);
  const setExportFileType = useAudioStore((state) => state.setExportFileType);
  const setProcessingLoading = useAudioStore(
    (state) => state.setProcessingLoading
  );
  const setSliceProgress = useAudioStore((state) => state.setSliceProgress);

  const [downloading, setDownloading] = useState(false);

  const isMobile = useMediaQuery("(max-width: 800px)");
  const view = useEffectiveView();
  const formats = useOfferedFormats(view === "advanced", exportFileType);

  const handleExportFiles = async () => {
    setDownloading(true);
    setProcessingLoading(true);
    setSliceProgress(null);

    try {
      const zip = await AudioService.sliceAllFilesIntoZip(
        useAudioStore.getState().tracks,
        masterExportSettings(),
        { onProgress: setSliceProgress }
      );

      // The zip is the only export blob that ever becomes a URL, and
      // `downloadBlob` revokes it. Every file inside it went in as a `Blob`.
      downloadBlob(zip, "sliced-audio.zip");
    } finally {
      setSliceProgress(null);
      setProcessingLoading(false);
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardContent className="mt-6">
        <div
          className={`flex flex-col space-y-4 ${isMobile
            ? "flex-col justify-center items-center w-full"
            : "sm:flex-row sm:justify-center gap-8 sm:space-x-2 sm:space-y-0"
            }`}
        >
          <div className="flex flex-col w-full space-y-2">
            <Label className="w-full flex gap-2">Normalize Levels? 
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger><QuestionMarkCircledIcon /></TooltipTrigger>
                <TooltipContent className="bg-background border-2 border-white text-white w-80 border-dotted">
                  {/*
                    It used to say "maximize the volume". It did not do that and
                    it should not: it divided by the loudest single sample, which
                    is peak normalization. Two tracks can share a peak and sound
                    nothing alike. Ticket 010 made the switch measure loudness in
                    LUFS, which is what "consistent" always meant.
                  */}
                  <p>Bring every track to the same loudness, so they sound equally loud beside each other. Peaks are held below the ceiling, so nothing clips.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            </Label>
            <Select
              onValueChange={(checked) => {
                setNormalizeAudio(checked === "true");
              }}
              value={normalizeAudio.toString()}
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
            <Label className="w-full flex gap-2">Apply Post Processing?
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger><QuestionMarkCircledIcon /></TooltipTrigger>
                <TooltipContent className="bg-background border-2 border-white text-white w-80 border-dotted">
                  <p>Apply audio compression to all tracks to even out the loud and quiet parts - this will make the audio sound less dynamic, but more consistent</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            </Label>
            <Select
              onValueChange={(checked) => {
                setApplyPostProcessing(checked === "true");
              }}
              value={applyPostProcessing.toString()}
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
          {/*
            "Trim Silence?" used to sit here, commented out. Both the control
            and the operation are gone: `trimSilence` read an `AnalyserNode`
            before the offline render ran, so it read zeros and could never
            work. Splitting on silence is a Regions-feature ticket, and it makes
            regions rather than changing sound.
          */}
          <div className="flex flex-col w-full space-y-2">
            <Label className="w-full">Output Format</Label>
            <Select
              onValueChange={setExportFileType}
              value={exportFileType}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formats.map((format) => (
                  <SelectItem key={`filetype_${format}`} value={format}>
                    {FORMAT_LABEL[format]}
                  </SelectItem>
                ))}
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

/**
 * Which formats the **Output Format** select offers.
 *
 * Three rules, in order:
 *
 * 1. **Simple view offers WAV and MP3.** Ticket 011's rule 4 — Simple gains
 *    speed, not options.
 * 2. **Advanced view offers all four, minus what this browser cannot encode.**
 *    Only Opus can be missing; WAV, MP3 and FLAC need nothing from the browser.
 *    The probe is a real `AudioEncoder.isConfigSupported` call on the exact
 *    config we would use, because support varies by operating system and by
 *    channel count, not just by browser.
 * 3. **The format already chosen is always in the list.** A user who picked FLAC
 *    in Advanced view and switched to Simple still has FLAC — standing rule 5
 *    says a view switch never loses work — so the row has to exist or the select
 *    would read blank and quietly change what they get.
 */
function useOfferedFormats(
  advanced: boolean,
  current: OutputFormat
): OutputFormat[] {
  const [opusEncodable, setOpusEncodable] = useState(false);

  useEffect(() => {
    // Simple view never offers Opus, so it never asks. The answer is cached for
    // the life of the page, so switching views asks once at most.
    if (!advanced) return;

    let live = true;
    canEncodeOpus().then((can) => {
      if (live) setOpusEncodable(can);
    });

    return () => {
      live = false;
    };
  }, [advanced]);

  const offered = (advanced ? ADVANCED_FORMATS : SIMPLE_FORMATS).filter(
    (format) => opusEncodable || !needsWebCodecs(format)
  );

  return offered.includes(current) ? offered : [...offered, current];
}

export default MasterToolbar;
