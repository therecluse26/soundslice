import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../../tailwind.config";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import {
  PauseIcon,
  PlayIcon,
  DownloadIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { useTheme } from "@/hooks/useTheme";
import { AudioFile, useAudioStore } from "@/stores/audio-store";
import { AudioTrimmer } from "@/lib/audio-trimmer";

// Interfaces
interface WaveformProps {
  file: AudioFile;
}

// Utility functions
const formatTime = (seconds: number) =>
  [seconds / 60, seconds % 60]
    .map((v) => `0${Math.floor(v)}`.slice(-2))
    .join(":");

const filenameWithoutExtension = (filename: string) => {
  return filename.split(".").slice(0, -1).join(".");
};

export const AudioEditor = ({ file }: WaveformProps) => {
  // Hooks
  const { theme } = useTheme();
  const { getFile } = useAudioStore();
  const resolvedConfig = resolveConfig(tailwindConfig);
  const { colors } = resolvedConfig.theme;

  // Refs
  const audioContainer = useRef(null);
  const isPlaying = useRef(false);
  const currentTimeRef = useRef(0);

  // State
  const [selectionDuration, setSelectionDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Memoized values
  const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
  const hoverPlugin = useMemo(
    () =>
      HoverPlugin.create({
        lineColor: "#ff0000",
        lineWidth: 2,
        labelBackground: "#555",
        labelColor: "#fff",
        labelSize: "11px",
      }),
    []
  );
  const timelinePlugin = useMemo(() => TimelinePlugin.create(), []);
  const plugins = useMemo(
    () => [regionsPlugin, hoverPlugin, timelinePlugin],
    [regionsPlugin, hoverPlugin, timelinePlugin]
  );
  const url = useMemo(() => URL.createObjectURL(file.file), [file]);
  const audioTrimmer = useMemo(() => new AudioTrimmer(), []);

  // Wavesurfer setup
  const { wavesurfer } = useWavesurfer({
    container: audioContainer,
    height: 100,
    waveColor: theme === "dark" ? colors.gray[700] : colors.gray[400],
    progressColor: theme === "dark" ? colors.red[500] : colors.red[500],
    barWidth: 3,
    barGap: 2,
    barRadius: 10,
    sampleRate: 48000,
    url,
    plugins,
  });

  // Callbacks
  const onPlayPause = useCallback(() => {
    wavesurfer && wavesurfer.playPause();
    isPlaying.current = !isPlaying.current;
  }, [wavesurfer]);

  const onUpdatedRegion = useCallback((region: Region) => {
    setSelectionDuration(region.end - region.start);

    if (
      isPlaying.current &&
      (currentTimeRef.current < region.start ||
        currentTimeRef.current > region.end)
    ) {
      region.play();
    }
  }, []);

  const handleTrimAudio = async () => {
    if (!wavesurfer) return null;

    const region = regionsPlugin.getRegions()[0];
    const trimmedBuffer = audioTrimmer.trimAudio(region.start, region.end);
    const downloadUrl = audioTrimmer.createDownloadLink(
      trimmedBuffer,
      `trimmed_${file.file.name}`
    );
    return downloadUrl;
  };

  const downloadTrimmedFile = async () => {
    setDownloading(true);
    const url = await handleTrimAudio();
    if (!url) return;

    const link = document.createElement("a");
    link.style.display = "none";
    link.href = url;
    link.download = `trimmed_${filenameWithoutExtension(file.file.name)}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloading(false);
  };

  // Effects
  useEffect(() => {
    audioTrimmer.loadAudioFile(file.file);
  }, [file, audioTrimmer]);

  useEffect(() => {
    if (!wavesurfer) return;

    wavesurfer.on("play", () => {
      isPlaying.current = true;
      regionsPlugin.getRegions()[0].play();
    });

    wavesurfer.on("timeupdate", (currentTime) => {
      currentTimeRef.current = currentTime;
    });

    wavesurfer.on("click", (location) => {
      const region = regionsPlugin.getRegions()[0];
      const start = region.start / wavesurfer.getDuration();
      const end = region.end / wavesurfer.getDuration();

      if (location < start || location > end) {
        region.play();
      }
    });

    wavesurfer.on("pause", () => {
      isPlaying.current = false;
    });

    wavesurfer.on("ready", () => {
      setReady(true);
      regionsPlugin.addRegion({
        start: 1,
        end: 100,
        content: "Section to Keep",
        color: "rgba(254, 242, 242, 0.25)",
        minLength: 5,
      });

      regionsPlugin.on("region-updated", onUpdatedRegion);

      regionsPlugin.on("region-out", (region) => {
        region.play();
      });
    });

    return () => {
      wavesurfer.unAll();
    };
  }, [wavesurfer, regionsPlugin, onUpdatedRegion]);

  // Render
  return (
    <Card>
      <CardContent className="pt-8 pb-0">
        {!ready && (
          <div className="text-center">
            <div>Preparing audio...</div>
          </div>
        )}

        <div ref={audioContainer} className="cursor-text" />

        {ready && (
          <div className="cursor-default w-full flex justify-between mt-4">
            <div>
              <div>
                File:{" "}
                <i className="text-primary">
                  {getFile(file.file.name)?.file.name}
                </i>
              </div>
              <div>
                Selection duration: <code>{formatTime(selectionDuration)}</code>
              </div>
            </div>
            <div style={{ margin: "1em 0", display: "flex", gap: "1em" }}>
              <Button
                onClick={onPlayPause}
                style={{ minWidth: "5em" }}
                className="bg-primary-foreground text-primary hover:bg-primary hover:text-primary-foreground"
              >
                {isPlaying.current ? <PauseIcon /> : <PlayIcon />}
              </Button>

              {downloading ? (
                <>
                  <Button disabled>
                    <ReloadIcon className="animate-spin" />
                    &nbsp; Download Trimmed Audio
                  </Button>
                </>
              ) : (
                <Button
                  onClick={downloadTrimmedFile}
                  style={{ minWidth: "5em" }}
                  className="bg-primary text-primary-foreground hover:bg-primary-foreground hover:text-primary"
                >
                  <DownloadIcon />
                  &nbsp; Download Trimmed Audio
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
