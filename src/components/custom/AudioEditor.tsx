import React, {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useState,
  lazy,
  Suspense,
} from "react";
import { useWavesurfer } from "@wavesurfer/react";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline";
import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom';
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
import { useAudioStore } from "@/stores/audio-store";
import { AudioService } from "@/lib/audio-service";
import { useMediaQuery } from "@/lib/use-media-query";
import { Slider } from "../ui/slider";
import { useEffectiveView } from "@/hooks/useEffectiveView";
import { HiddenRegionsChip } from "./HiddenRegionsChip";
import { countRender } from "@/lib/render-count";

/**
 * The lazy-load boundary for Advanced view.
 *
 * A dynamic import, so Vite emits a separate chunk. A Simple view user never
 * downloads it. Keep every Advanced-only module behind this import.
 */
const AdvancedPanel = lazy(() => import("./advanced/AdvancedPanel"));

// Interfaces
interface EditorProps {
  /**
   * The file this card owns.
   *
   * A `File`, not an `EditorTrack`, and deliberately. The store keeps the same
   * `File` object across a merge, so this prop never changes identity and
   * `React.memo` blocks every redraw driven by the parent. The card's own
   * redraws come from its own store selector below.
   */
  file: File;
}

// Utility functions
const formatTime = (seconds: number) =>
  [seconds / 60, seconds % 60]
    .map((v) => `0${Math.floor(v)}`.slice(-2))
    .join(":");

const filenameWithoutExtension = (filename: string) => {
  return filename.split(".").slice(0, -1).join(".");
};

export const AudioEditor = React.memo(({ file }: EditorProps) => {
  if (import.meta.env.DEV) countRender(`AudioEditor:${file.name}`);

  // Hooks
  const { theme } = useTheme();

  // Subscribes to this one track. Editing another track leaves this selector's
  // result identical, so this card does not redraw.
  const track = useAudioStore((state) =>
    state.tracks.find((t) => t.file.name === file.name)
  );
  const setTrackRegion = useAudioStore((state) => state.setTrackRegion);

  const resolvedConfig = resolveConfig(tailwindConfig);
  const { colors } = resolvedConfig.theme;
  const isMobile = useMediaQuery("(max-width: 800px)");
  const view = useEffectiveView();

  // Refs
  const audioContainer = useRef<HTMLDivElement | null>(null);
  const isPlaying = useRef(false);
  const currentTimeRef = useRef(0);
  const inFocus = useRef(false);

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
  const zoomPlugin = useMemo(() => ZoomPlugin.create({
    exponentialZooming: true,
    deltaThreshold: 1000000,
  }), [])
  const timelinePlugin = useMemo(() => TimelinePlugin.create(), []);
  const plugins = useMemo(
    () => [regionsPlugin, hoverPlugin, timelinePlugin, zoomPlugin],
    [regionsPlugin, hoverPlugin, timelinePlugin, zoomPlugin]
  );

  // Keyed on the file, not the track. A region write gives a new track object,
  // and rebuilding this URL there would reload the whole waveform on every drag.
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  // Wavesurfer setup
  const { wavesurfer } = useWavesurfer({
    container: audioContainer,
    height: isMobile ? 80 : 100,
    waveColor: theme === "dark" ? colors.gray[700] : colors.gray[400],
    progressColor: theme === "dark" ? colors.red[500] : colors.red[500],
    barWidth: isMobile ? 2 : 3,
    barGap: isMobile ? 1 : 2,
    barRadius: 10,
    sampleRate: 44100,
    url,
    plugins,
    autoScroll: true,
    minPxPerSec: 100,
    fillParent: true,
  });

  // NOTE: this URL is never revoked, so every track holds its audio for the
  // life of the page. Revoking it here was tried and reverted. React
  // StrictMode mounts an effect, tears it down, and mounts it again, so the
  // cleanup ran while the card was still alive and every waveform stopped at
  // "Preparing audio..." with ERR_FILE_NOT_FOUND. A correct fix has to create
  // and revoke the URL inside one effect, which means the first render has no
  // URL to give wavesurfer. That is a change to how the card loads, not a
  // change to the store, so it does not belong in this ticket.

  // Redraw the waveform when its container changes width.
  //
  // This was a `requestAnimationFrame` loop that ran forever, per track, just to
  // poll `clientWidth`. A `ResizeObserver` gives the same signal and costs
  // nothing while the width is steady. The width guard stays: setting the width
  // resizes the canvas, which would otherwise call the observer back.
  useEffect(() => {
    const container = audioContainer.current;
    if (!wavesurfer || !container) return;

    let lastWidth = container.clientWidth;

    const observer = new ResizeObserver(() => {
      const currentWidth = container.clientWidth;
      if (currentWidth === lastWidth) return;

      lastWidth = currentWidth;
      wavesurfer.setOptions({ container, width: currentWidth });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [wavesurfer]);

  // Callbacks
  const onPlayPause = useCallback(() => {
    wavesurfer && wavesurfer.playPause();
    isPlaying.current = !isPlaying.current;
  }, [wavesurfer]);

  /**
   * Fires when a drag or resize **finishes**, once, not once per frame. So the
   * store takes one write per edit. Only the two numbers cross the boundary;
   * the wavesurfer `Region` object stays in this component.
   */
  const onUpdatedRegion = useCallback(
    (region: Region) => {
      if (import.meta.env.DEV) countRender("event:region-updated");

      setTrackRegion(file.name, { start: region.start, end: region.end });
      setSelectionDuration(region.end - region.start);

      if (
        isPlaying.current &&
        (currentTimeRef.current < region.start ||
          currentTimeRef.current > region.end)
      ) {
        region.play();
      }
    },
    [file.name, setTrackRegion]
  );

  const downloadTrimmedFile = async () => {
    setDownloading(true);

    // Read at click time, so this card never subscribes to the export settings.
    const {
      getTrack,
      normalizeAudio,
      applyPostProcessing,
      trimSilence,
      exportFileType,
    } = useAudioStore.getState();

    const currentTrack = getTrack(file.name);
    if (!currentTrack) {
      setDownloading(false);
      return;
    }

    const blobUrl = await AudioService.sliceAudio(
      currentTrack,
      normalizeAudio,
      applyPostProcessing,
      trimSilence,
      exportFileType
    );
    if (!blobUrl) {
      setDownloading(false);
      return;
    }

    const link = document.createElement("a");
    link.style.display = "none";
    link.href = blobUrl;
    link.download = `trimmed_${filenameWithoutExtension(file.name)}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloading(false);
  };

  // Effects
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
      const newRegion = regionsPlugin.addRegion({
        start: 1,
        end: 100,
        content: "Clip",
        color: "rgba(254, 242, 242, 0.25)",
        minLength: 5,
      });

      handleZoom([0])

      // Necessary to set region to trim if region is not changed
      onUpdatedRegion(newRegion);

      regionsPlugin.on("region-updated", onUpdatedRegion);

      regionsPlugin.on("region-out", (region) => {
        region.play();
      });
    });

    return () => {
      wavesurfer.unAll();
    };
  }, [wavesurfer, regionsPlugin, onUpdatedRegion]);

  // Add zoom handler
  const handleZoom = useCallback(
    (value: number[]) => {
      if (!wavesurfer) return;
      wavesurfer.zoom(value[0]);
    },
    [wavesurfer]
  );

  // Add keyboard handler
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if(!inFocus.current) return;

      // Prevent spacebar from triggering if user is typing in an input field
      if (event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        onPlayPause();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [onPlayPause]);

  useEffect(() => {
    const container = audioContainer.current;
    if (!container) return;
    container.addEventListener('mouseover', () => {
      inFocus.current = true;
    });
    container.addEventListener('mouseout', () => {
      inFocus.current = false;
    });
  }, []);

  // Render
  return (
    <Card>
      <CardContent className={`pt-8 pb-0 ${isMobile ? "px-2" : "px-6"}`}>
        {!ready && (
          <div className="text-center">
            <div>Preparing audio...</div>
          </div>
        )}

        <div className="w-full scrollbar-thin scrollbar-track-background scrollbar-thumb-primary hover:scrollbar-thumb-primary">
          <div
            ref={audioContainer}
            className="cursor-text min-w-full"
          />
        </div>

        {ready && (
          <div
            className={`cursor-default w-full ${
              isMobile
                ? "flex flex-col gap-4 space-y-4"
                : "flex gap-4 justify-between"
            } mt-4`}
          >
            <div>
              <div className={isMobile ? "text-sm" : ""}>
                File:{" "}
                <i className="text-primary text-wrap break-all">
                  {file.name}
                </i>
              </div>
              <div className={isMobile ? "text-sm" : ""}>
                Selection duration: <code>{formatTime(selectionDuration)}</code>
              </div>
              {track && <HiddenRegionsChip track={track} />}
            </div>
            <div className="flex gap-2 items-center w-[300px]">
                Zoom:
                <Slider
                  defaultValue={[0]}
                  min={0}
                  max={200}
                  step={0.1}
                  onValueChange={handleZoom}
                />
              </div>
            <div
              className={`${isMobile ? "flex justify-between" : "flex gap-4"}`}
            >

              <Button
                onClick={onPlayPause}
                className={`bg-primary-foreground text-primary hover:bg-primary hover:text-primary-foreground px-4 py-2 ${
                  isMobile ? "mb-2" : ""
                }`}
              >
                {isPlaying.current ? <PauseIcon /> : <PlayIcon />}
              </Button>

              {downloading ? (
                <Button
                  disabled
                  className={isMobile ? "px-4 py-2 text-xs mb-2" : "px-4 py-2"}
                >
                  <ReloadIcon className="animate-spin" />
                  <span className="ml-2">
                    {isMobile ? "Downloading..." : "Slice Audio"}
                  </span>
                </Button>
              ) : (
                <Button
                  onClick={downloadTrimmedFile}
                  className={`bg-primary text-primary-foreground hover:bg-primary-foreground hover:text-primary ${
                    isMobile ? "px-2 py-1 text-xs" : "px-4 py-2"
                  }`}
                >
                  <DownloadIcon />
                  <span className="ml-2">
                    {isMobile ? "Download" : "Slice Audio"}
                  </span>
                </Button>
              )}
            </div>
          </div>
        )}

        {/*
          The Advanced panel sits below the waveform and the controls, so
          switching view never moves the waveform. That is ticket 012's
          acceptance: the thing the user is looking at stays where it is.
        */}
        {ready && view === "advanced" && (
          <div className="mt-2 border-t pt-1">
            <Suspense
              fallback={
                <p className="py-4 text-xs text-muted-foreground">
                  Loading advanced controls…
                </p>
              }
            >
              <AdvancedPanel />
            </Suspense>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
