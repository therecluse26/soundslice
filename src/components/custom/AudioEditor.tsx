import React, {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useState,
  lazy,
  Suspense,
} from "react";
import { useWavesurferInstance } from "@/hooks/useWavesurferInstance";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline";
import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom';
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import {
  PauseIcon,
  PlayIcon,
  DownloadIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  masterExportSettings,
  selectedRegion,
  useAudioStore,
} from "@/stores/audio-store";
import type { EditorTrack, TrackRegion } from "@/stores/audio-store";
import { AudioService } from "@/lib/audio-service";
import { downloadBlob } from "@/lib/download";
import { useMediaQuery } from "@/lib/use-media-query";
import { Slider } from "../ui/slider";
import { useEffectiveView } from "@/hooks/useEffectiveView";
import { HiddenRegionsChip } from "./HiddenRegionsChip";
import { PreviewEffects } from "./PreviewEffects";
import { usePreview } from "@/hooks/usePreview";
import { countRender } from "@/lib/render-count";
import { REGION_COLORS, WAVEFORM_COLORS } from "@/lib/waveform-colors";
import { defaultRegion, firstRegion, regionLabel } from "@/lib/edit-stack";
import { stemOf } from "@/lib/file-names";
// Shared with `MasterToolbar`, so the two export buttons cannot disagree
// about what Simple view exports. See the function's own comment.
import { exportableTrack } from "@/lib/advanced-settings";

/**
 * The lazy-load boundary for Advanced view.
 *
 * A dynamic import, so Vite emits a separate chunk. A Simple view user never
 * downloads it. Keep every Advanced-only module behind this import.
 */
const AdvancedPanel = lazy(() => import("./advanced/AdvancedPanel"));

/**
 * The region tools, as a strip above the waveform.
 *
 * Advanced-only, so it sits behind its own dynamic import — standing rule 6.
 */
const RegionToolbar = lazy(() => import("./advanced/RegionToolbar"));

/**
 * The input and output meters, beside the play button.
 *
 * Its own chunk rather than a part of `AdvancedPanel`, because it is on screen
 * whenever an Advanced card is, and the panel is only downloaded when a section
 * is opened. Advanced-only — standing rule 6.
 */
const TransportMeters = lazy(() => import("./advanced/TransportMeters"));

/**
 * A region's gain, fades, name and delete — drawn **on the region**.
 *
 * It renders nothing itself. It hangs plain DOM on each wavesurfer region
 * element, because that element belongs to the plugin and React cannot own a
 * node another library creates and destroys.
 */
const RegionInlineControls = lazy(
  () => import("./advanced/RegionInlineControls")
);

/**
 * The transient magnet, which draws nothing.
 *
 * A component rather than a hook call, because a hook cannot be called
 * conditionally and this one reaches onset detection, which reaches the decoder.
 * Calling it here cost the Simple bundle **4.99 KiB gzip, measured**, for a tool
 * Simple view cannot switch on. Standing rule 6.
 */
const RegionMagnet = lazy(() => import("./advanced/RegionMagnet"));

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

/**
 * The region a track gets when it has none yet.
 *
 * The regions plugin clamps `end` to the file's duration, so a 30-second file
 * gets 1–30 and a 5-minute file gets 1–100. Anything that replaces this default
 * must keep that clamp, or a short file gets a region past its end.
 */
const DEFAULT_REGION = { start: 1, end: 100 };

/**
 * The shortest region a **resize** may produce, per view, in seconds.
 *
 * Simple view keeps 5 seconds, which is the figure this card has enforced since
 * before this map existed. Standing rule 4: nothing that already works changes.
 *
 * Advanced view needs far less. Split on silence cuts spoken phrases, and a
 * 5-second floor would refuse most of them. A region shorter than the fade edges
 * is still legal — `fadeTimes` shortens both fades to fit rather than letting
 * them overlap.
 */
const MIN_REGION_SEC = { simple: 5, advanced: 0.05 } as const;

/** Stable identity for a track that is not in the store yet. */
const NO_REGIONS: TrackRegion[] = [];

export const AudioEditor = React.memo(({ file }: EditorProps) => {
  if (import.meta.env.DEV) countRender(`AudioEditor:${file.name}`);

  // Hooks
  const { theme } = useTheme();

  // Subscribes to this one track. Editing another track leaves this selector's
  // result identical, so this card does not redraw.
  const track = useAudioStore((state) =>
    state.tracks.find((t) => t.file.name === file.name)
  );
  const ensureTrackRegions = useAudioStore((state) => state.ensureTrackRegions);
  const addTrackRegion = useAudioStore((state) => state.addTrackRegion);
  const updateTrackRegion = useAudioStore((state) => state.updateTrackRegion);
  const removeTrackRegion = useAudioStore((state) => state.removeTrackRegion);
  const selectTrackRegion = useAudioStore((state) => state.selectTrackRegion);

  const isMobile = useMediaQuery("(max-width: 800px)");
  const view = useEffectiveView();

  const regions = track?.regions ?? NO_REGIONS;
  const selected = selectedRegion(track);
  const selectedId = selected?.id;

  // Refs
  const audioContainer = useRef<HTMLDivElement | null>(null);
  const isPlaying = useRef(false);
  const currentTimeRef = useRef(0);
  const inFocus = useRef(false);

  /**
   * The wavesurfer region objects this card has drawn, by our id.
   *
   * The store holds plain numbers and this holds the live objects, exactly as
   * before — ticket 009's rule is unchanged by there being six of them. The two
   * are kept in step by one reconciling effect and nothing else writes here.
   */
  const drawn = useRef(new Map<string, Region>());

  /**
   * True while the reconciler is writing to the plugin.
   *
   * `addRegion` and `remove()` both emit synchronously, so without this the
   * card would hear its own writes and write them back. `setOptions` emits
   * nothing at all — checked in the plugin source — so a bounds correction is
   * already safe; creation and removal are the two that need the guard.
   */
  const applying = useRef(false);

  /** True once this card has given the track its first region. */
  const seeded = useRef(false);

  // State
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

  // The blob URL this card hands to wavesurfer.
  //
  // A blob URL pins its blob in memory until it is revoked, so a card that never
  // revokes holds its whole encoded file for the life of the page. A 45-minute
  // WAV is about 476 MB. See ticket 015.
  //
  // Created **and** revoked inside one effect, deliberately. A `useMemo` plus a
  // separate cleanup effect looks equivalent and is not: React StrictMode mounts
  // an effect, tears it down, then mounts it again, so that cleanup revoked a
  // URL the card was still using. Every waveform then stopped at "Preparing
  // audio..." with ERR_FILE_NOT_FOUND. One effect owning both halves means the
  // live URL is always the one the current effect created.
  //
  // Keyed on the file, not the track. A region write gives a new track object,
  // and rebuilding this URL there would reload the whole waveform on every drag.
  //
  // The cost is one render with no URL. The card already shows "Preparing
  // audio..." until wavesurfer reports ready, so nothing new appears on screen.
  // wavesurfer treats a missing `url` as "nothing to load" and waits.
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // Wavesurfer setup.
  //
  // `useWavesurferInstance`, not `@wavesurfer/react`'s `useWavesurfer`. That one
  // also keeps `currentTime` in React state and updates it on every
  // `timeupdate`, which redrew this whole card about sixty times a second for a
  // value it never reads. Ticket 020. The playhead lives in `currentTimeRef`.
  const wavesurfer = useWavesurferInstance(audioContainer, {
    height: isMobile ? 80 : 100,
    waveColor:
      theme === "dark"
        ? WAVEFORM_COLORS.waveDark
        : WAVEFORM_COLORS.waveLight,
    // Both branches were already the same colour. Kept as a branch because the
    // theme is forced to dark today, and reviving light theme is its own
    // decision — ticket 014 is only about bundle size.
    progressColor:
      theme === "dark"
        ? WAVEFORM_COLORS.progress
        : WAVEFORM_COLORS.progress,
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

  // Routes wavesurfer's own `<audio>` element through this track's edit stack,
  // so the play button plays the region the way it will export. wavesurfer keeps
  // the playhead, the seeking and the region-out handling.
  const preview = usePreview(wavesurfer, track);

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

  // Add zoom handler
  const handleZoom = useCallback(
    (value: number[]) => {
      if (!wavesurfer) return;
      wavesurfer.zoom(value[0]);
    },
    [wavesurfer]
  );

  /**
   * Fires when a drag or resize **finishes**, once, not once per frame.
   *
   * That is the whole of undo's coalescing problem solved by the library:
   * `region-update` fires on every frame of a drag and this does not, so
   * dragging an edge across 200 pixels writes one region and pushes one history
   * entry. No timer, and no coalesce key — two separate drags are two gestures
   * and must undo separately.
   */
  const onUpdatedRegion = useCallback(
    (region: Region) => {
      if (import.meta.env.DEV) countRender("event:region-updated");

      updateTrackRegion(
        file.name,
        region.id,
        { start: region.start, end: region.end },
        { label: "Move region" }
      );

      if (
        isPlaying.current &&
        region.id === useAudioStore.getState().getTrack(file.name)
          ?.selectedRegionId &&
        (currentTimeRef.current < region.start ||
          currentTimeRef.current > region.end)
      ) {
        region.play();
      }
    },
    [file.name, updateTrackRegion]
  );

  /**
   * Draws the store's regions onto the waveform, and nothing more.
   *
   * One direction only: the store is the truth and this is the picture of it.
   * Every gesture writes to the store first, and the store's change brings this
   * effect back to draw the result — so there is no second place that decides
   * where a region is.
   */
  useEffect(() => {
    if (!wavesurfer || !ready) return;

    const wanted = new Map(regions.map((region) => [region.id, region]));
    const minLength = MIN_REGION_SEC[view];
    const corrections: TrackRegion[] = [];

    // **Simple view alone gets the plugin's own label.**
    //
    // In Advanced view the overlay draws the name itself, as a label you can
    // double-click and type into. Letting the plugin draw one too put the name
    // on every region twice. A view switch rebuilds every region anyway —
    // `minLength` differs and cannot be changed after creation — so this is
    // decided once per region and never has to be undone.
    const pluginDrawsLabel = view === "simple";

    applying.current = true;
    try {
      // Gone from the store, or drawn under the other view's minimum length.
      // `minLength` cannot be changed after creation — `setOptions` leaves it
      // out on purpose — so a view switch redraws rather than adjusts.
      for (const [id, existing] of [...drawn.current]) {
        if (!wanted.has(id) || existing.minLength !== minLength) {
          existing.remove();
          drawn.current.delete(id);
        }
      }

      for (const region of regions) {
        const label = regionLabel(regions, region);

        // Simple view never draws the selected shade. It shows one region, so
        // there is nothing to tell apart, and it keeps exactly the colour it has
        // always had.
        const color =
          !pluginDrawsLabel && region.id === selectedId
            ? REGION_COLORS.selected
            : REGION_COLORS.region;

        const existing = drawn.current.get(region.id);

        if (!existing) {
          const created = regionsPlugin.addRegion({
            id: region.id,
            start: region.start,
            end: region.end,
            content: pluginDrawsLabel ? label : undefined,
            color,
            minLength,
          });

          drawn.current.set(region.id, created);

          // The plugin clamps to the file's duration. A stored region past the
          // end — the 1–100 default on a 30-second file — comes back shorter,
          // and the store has to learn that or this effect would correct it on
          // every run. Ticket 017 wrote the clamped bounds back for the same
          // reason.
          if (created.start !== region.start || created.end !== region.end) {
            corrections.push({
              ...region,
              start: created.start,
              end: created.end,
            });
          }
          continue;
        }

        if (
          existing.start !== region.start ||
          existing.end !== region.end ||
          existing.color !== color
        ) {
          existing.setOptions({
            start: region.start,
            end: region.end,
            color,
          });
        }

        if (pluginDrawsLabel && existing.content?.textContent !== label) {
          existing.setContent(label);
        }
      }
    } finally {
      applying.current = false;
    }

    for (const correction of corrections) {
      updateTrackRegion(
        file.name,
        correction.id,
        { start: correction.start, end: correction.end },
        { silent: true }
      );
    }
  }, [
    wavesurfer,
    ready,
    regions,
    selectedId,
    view,
    regionsPlugin,
    file.name,
    updateTrackRegion,
  ]);

  /**
   * Gives the track its first region, and keeps Simple view's promise.
   *
   * Two rules in one effect, because both say "this track has no regions and
   * needs one":
   *
   * 1. A track that has never had a region gets the 1–100 default, clamped.
   * 2. **Simple view always keeps one.** An Advanced user may delete every
   *    region and leave zero — that is legal and the card says so — but Simple
   *    view has no way to make one, so it must never be shown an empty track.
   */
  useEffect(() => {
    if (!ready || !wavesurfer) return;

    if (regions.length > 0) {
      seeded.current = true;
      return;
    }

    if (seeded.current && view !== "simple") return;

    const duration = wavesurfer.getDuration();
    ensureTrackRegions(file.name, [
      defaultRegion(
        Math.min(DEFAULT_REGION.start, Math.max(0, duration - 1)),
        Math.min(DEFAULT_REGION.end, duration)
      ),
    ]);

    seeded.current = true;
  }, [ready, wavesurfer, regions.length, view, ensureTrackRegions, file.name]);

  /**
   * Drag on empty waveform makes a region. Advanced view only.
   *
   * Dragging **inside** an existing region moves it instead, because the
   * region's own element sits above the wrapper and stops the event. So create
   * and move never fight, and two regions can be made to overlap.
   */
  useEffect(() => {
    if (!wavesurfer || !ready || view !== "advanced") return;

    return regionsPlugin.enableDragSelection({
      color: REGION_COLORS.region,
      minLength: MIN_REGION_SEC.advanced,
    });
  }, [wavesurfer, ready, view, regionsPlugin]);

  const downloadTrimmedFile = async () => {
    setDownloading(true);

    // Read at click time, so this card never subscribes to the export settings.
    const settings = masterExportSettings();
    const currentTrack = useAudioStore.getState().getTrack(file.name);

    if (!currentTrack) {
      setDownloading(false);
      return;
    }

    try {
      const files = await AudioService.sliceTrackFiles(
        exportableTrack(currentTrack, view),
        settings,
        { prefix: "trimmed_" }
      );

      // Zero regions exports nothing, and says nothing happened rather than
      // reporting a download that did not. Ticket 016's rule.
      if (files.length === 0) return;

      // One region keeps today's name exactly — `trimmed_<stem>.<ext>`, no
      // suffix — because `regionFileName` leaves the suffix off when a track has
      // one region. Nothing that works today changes.
      if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name);
        return;
      }

      downloadBlob(
        await AudioService.zipFiles(files),
        `trimmed_${stemOf(file.name)}.zip`
      );
    } finally {
      setDownloading(false);
    }
  };

  // Effects
  useEffect(() => {
    if (!wavesurfer) return;

    /**
     * Every listener this effect adds, so the cleanup can remove exactly those.
     *
     * It used to call `wavesurfer.unAll()`, which removes **every** listener on
     * the instance — including the two `usePreview` registers for the region
     * envelope. Nothing warned, and preview would simply stop applying its fades
     * until something else made it re-register. Ticket 020's "watch for".
     */
    const off: Array<() => void> = [];

    /** The region the play button plays, read fresh. Never a stale closure. */
    const playing = () =>
      drawn.current.get(
        selectedRegion(useAudioStore.getState().getTrack(file.name))?.id ?? ""
      );

    off.push(
      wavesurfer.on("play", () => {
        isPlaying.current = true;
        playing()?.play();
      })
    );

    off.push(
      wavesurfer.on("timeupdate", (currentTime) => {
        currentTimeRef.current = currentTime;
      })
    );

    off.push(
      wavesurfer.on("click", (location) => {
        const region = playing();
        if (!region) return;

        const start = region.start / wavesurfer.getDuration();
        const end = region.end / wavesurfer.getDuration();

        if (location < start || location > end) {
          region.play();
        }
      })
    );

    off.push(
      wavesurfer.on("pause", () => {
        isPlaying.current = false;
      })
    );

    off.push(
      wavesurfer.on("ready", () => {
        setReady(true);
        handleZoom([0]);
      })
    );

    // On the plugin, not on wavesurfer, so the old `unAll()` never removed
    // these and a second `ready` stacked another set on top.
    off.push(regionsPlugin.on("region-updated", onUpdatedRegion));

    off.push(
      regionsPlugin.on("region-created", (region) => {
        // The reconciler's own creations are already in the store. Only a
        // region the **user** dragged into being reaches the store from here,
        // and it is adopted with the id the plugin minted, so there is one id
        // and not two.
        if (applying.current) return;

        drawn.current.set(region.id, region);
        addTrackRegion(file.name, {
          ...defaultRegion(region.start, region.end),
          id: region.id,
        });
      })
    );

    off.push(
      regionsPlugin.on("region-clicked", (region) => {
        selectTrackRegion(file.name, region.id);
      })
    );

    off.push(
      regionsPlugin.on("region-removed", (region) => {
        if (applying.current) return;
        drawn.current.delete(region.id);
        removeTrackRegion(file.name, region.id);
      })
    );

    off.push(
      regionsPlugin.on("region-out", (region) => {
        // Only the region being played loops. Regions may overlap now, so
        // leaving one the user is not listening to must not restart playback.
        if (region.id === playing()?.id) region.play();
      })
    );

    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [
    wavesurfer,
    regionsPlugin,
    onUpdatedRegion,
    file.name,
    addTrackRegion,
    removeTrackRegion,
    selectTrackRegion,
    handleZoom,
  ]);

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

      // Delete removes the selected region. Advanced view only: Simple view
      // always keeps one, so a Simple user pressing Delete would watch it come
      // straight back.
      if (
        view === "advanced" &&
        (event.code === "Delete" || event.code === "Backspace") &&
        selectedId
      ) {
        event.preventDefault();
        removeTrackRegion(file.name, selectedId);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
    };
  }, [onPlayPause, view, selectedId, removeTrackRegion, file.name]);

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
    // Named so undo can scroll to the card it changed. One history serves the
    // whole project, so the card an undo acts on is often off screen.
    <Card data-track-card={file.name}>
      <CardContent className={`pt-8 pb-0 ${isMobile ? "px-2" : "px-6"}`}>
        {!ready && (
          <div className="text-center">
            <div>Preparing audio...</div>
          </div>
        )}

        {/*
          The tools sit directly above the waveform they act on. They were an
          accordion below the card, which asked the user to look away from the
          thing they were cutting.
        */}
        {ready && view === "advanced" && (
          <Suspense fallback={null}>
            <RegionToolbar
              fileName={file.name}
              durationSec={wavesurfer?.getDuration() ?? 0}
            />
          </Suspense>
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
                Selection duration:{" "}
                <code>
                  {formatTime(selected ? selected.end - selected.start : 0)}
                </code>
              </div>
              {regions.length === 0 && (
                <div className="mt-1 text-sm text-amber-500">
                  No regions — this track exports nothing. Drag on the waveform
                  to make one.
                </div>
              )}
              {track && <HiddenRegionsChip track={track} />}
              {/*
                In both views, deliberately. It changes no exported file, and a
                Simple user who cannot hear the raw cut cannot tell what the two
                switches did. Ticket 019 records the reasoning.
              */}
              <div className="mt-2">
                <PreviewEffects
                  fileName={file.name}
                  effects={track?.previewEffects ?? true}
                  preview={preview}
                />
              </div>
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

              {/*
                Advanced view only, and beside the transport because that is
                where you are looking while a track plays. Nothing here renders
                per frame — the level is written onto a canvas from an animation
                frame and never becomes React state. See `useMeterPair`.
              */}
              {view === "advanced" && (
                <Suspense fallback={null}>
                  <TransportMeters meters={preview.meters} />
                </Suspense>
              )}

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
          Two components that draw nothing of their own. One hangs the gain
          line, the fade grips, the name and the delete on each region; the
          other registers the magnet on `region-update`. Both are here rather
          than beside `usePreview` so a Simple view user downloads neither.
        */}
        {ready && view === "advanced" && (
          <Suspense fallback={null}>
            <RegionInlineControls
              wavesurfer={wavesurfer}
              regionsPlugin={regionsPlugin}
              fileName={file.name}
            />
            <RegionMagnet
              wavesurfer={wavesurfer}
              regionsPlugin={regionsPlugin}
              file={file}
            />
          </Suspense>
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
              <AdvancedPanel fileName={file.name} meters={preview.meters} />
            </Suspense>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

