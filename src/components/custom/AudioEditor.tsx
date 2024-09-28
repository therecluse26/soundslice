import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../../tailwind.config";
import { Card, CardContent, CardFooter } from "../ui/card";
import { Button } from "../ui/button";
import { PauseIcon, PlayIcon } from "@radix-ui/react-icons";
import { useTheme } from "@/hooks/useTheme";

const formatTime = (seconds: number) =>
  [seconds / 60, seconds % 60]
    .map((v) => `0${Math.floor(v)}`.slice(-2))
    .join(":");

interface WaveformProps {
  file: File;
}

export const AudioEditor = ({ file }: WaveformProps) => {
  const { theme } = useTheme();
  const resolvedConfig = resolveConfig(tailwindConfig);
  const { colors } = resolvedConfig.theme;
  const audioContainer = useRef(null);
  const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
  const hoverPlugin = useMemo(() => HoverPlugin.create({
    lineColor: '#ff0000',
    lineWidth: 2,
    labelBackground: '#555',
    labelColor: '#fff',
    labelSize: '11px',
  }), []);
  const timelinePlugin = useMemo(() => TimelinePlugin.create(), []);
  const plugins = useMemo(() => [regionsPlugin, hoverPlugin, timelinePlugin], []);
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  const { wavesurfer, currentTime } = useWavesurfer({
    container: audioContainer,
    height: 100,
    waveColor: theme === "dark" ? colors.gray[700] : colors.gray[400],
    // progressColor: "hsl(24.6 95% 50%)",
    progressColor: theme === "dark" ? colors.red[500] : colors.red[700],
      // Set a bar width
    barWidth: 3,
    // Optionally, specify the spacing between bars
    barGap: 2,
    // And the bar radius
    barRadius: 10,
    url,
    plugins,
  });

  const [selectionDuration, setSelectionDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const isPlaying = useRef(false);

  const onPlayPause = useCallback(() => {
    wavesurfer && wavesurfer.playPause();
  }, [wavesurfer]);

  const onUpdatedRegion = useCallback((region: Region) => {
    // Update selection duration
    setSelectionDuration(region.end - region.start);

    // Check if playhead is within the region
    if (isPlaying.current && (currentTime < region.start || currentTime > region.end)) {
      region.play();
    }
  }, [setSelectionDuration, currentTime, isPlaying]);

  useEffect(() => {
    if (!wavesurfer) return;

    wavesurfer.on("play", () => {
      isPlaying.current = true;
      regionsPlugin.getRegions()[0].play();
    });

    wavesurfer.on('click', (location) => {
      // Play the region if the selected location is outside of the region, otherwise, just play the selected location
      const region = regionsPlugin.getRegions()[0];
      const start = region.start / wavesurfer.getDuration();
      const end = region.end / wavesurfer.getDuration();
      if(location < start || location > end) {
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
        content: 'Section to Keep',
        color: 'rgba(26, 48, 70, 0.5)',
        minLength: 10,

      });

      regionsPlugin.on("region-updated", onUpdatedRegion);

      // Enforce looping, don't allow playback outside of the region
      regionsPlugin.on("region-out", (region) => {
        region.play()
      });

    });

    return () => {
      wavesurfer.unAll();
    };
  }, [wavesurfer, regionsPlugin, onUpdatedRegion]);


  return (
    <Card>
      <CardContent className="pt-8 pb-0">
        {!ready && <div className="text-center">Preparing audio...</div>}

        <div ref={audioContainer} className="cursor-text" />
     

        <div className="cursor-default w-full flex justify-between mt-4">
          <div>
            <div>
              File: <i className="text-primary">{file.name}</i>
            </div>
            <div>
              Selection duration: <code>{formatTime(selectionDuration)}</code>
            </div>
          </div>
          <div style={{ margin: "1em 0", display: "flex", gap: "1em" }}>
            <Button onClick={onPlayPause} style={{ minWidth: "5em" }}>
              {isPlaying.current ? <PauseIcon /> : <PlayIcon />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
