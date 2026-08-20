import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import { AudioService } from "@/lib/audio-service";
import { masterExportSettings, useAudioStore } from "@/stores/audio-store";
import type { EditorTrack } from "@/stores/audio-store";
import { EditStack, needsMeasurement } from "@/lib/edit-stack";
import {
  PreviewGraph,
  attachPreview,
  measuresUnasked,
  resumePreview,
} from "@/lib/preview";

/**
 * What the card shows about preview.
 *
 * `normalized` is the honest answer to "is the level I am hearing the level I
 * will export?". It is false while a measurement is missing, and the card says
 * so rather than letting the user believe otherwise.
 */
export type PreviewState = {
  normalized: boolean;
  /** True while a measurement is running. */
  measuring: boolean;
  /**
   * True when the stack has something to measure and nothing has measured it.
   *
   * The card shows its note only then. A stack with no loudness and no peak
   * normalization is fully previewable and needs no explanation.
   */
  awaitingMeasurement: boolean;
  /**
   * True when this region is longer than preview will measure unasked.
   *
   * Over ten minutes the wait becomes a freeze, so preview stops and offers
   * instead. The user takes the wait knowingly or not at all.
   */
  tooLongToMeasure: boolean;
  /** Measures now, whatever the length. What "Measure anyway" calls. */
  measureNow: () => void;
};

/**
 * Plays a track's region through its edit stack.
 *
 * The card owns wavesurfer; this hook owns what happens to the sound between
 * wavesurfer's `<audio>` element and the speakers. wavesurfer keeps the
 * playhead, the click-to-seek, the scroll and the region-out handling it always
 * had — none of that moves.
 *
 * ## Nothing here subscribes to the store
 *
 * Moving the loudness target must be heard at once, and the target is a master
 * default. Selecting it would redraw **every card** whenever it changed, which
 * is the redraw storm ticket 009 removed.
 *
 * So this hook watches the store the imperative way, with
 * `useAudioStore.subscribe`, and pushes the change straight into the audio
 * graph. The graph is not React state and does not want to be: no render
 * happens, and the sound changes in the same tick.
 */
export function usePreview(
  wavesurfer: WaveSurfer | null,
  track: EditorTrack | undefined
): PreviewState {
  const graph = useRef<PreviewGraph | null>(null);
  const applied = useRef<string>("");
  const measuring = useRef(false);

  const [measured, setMeasured] = useState<ReadonlyMap<number, number> | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const region = track?.region;
  const fileName = track?.file.name;

  /** The stack this track exports through, read fresh. Never subscribed to. */
  const currentStack = useCallback(
    (): EditStack =>
      track ? AudioService.stackFor(track, masterExportSettings()) : [],
    [track]
  );

  // Attach once per element. `attachPreview` returns the same graph for an
  // element it has already routed, which is what makes StrictMode's double
  // mount harmless — `createMediaElementSource` throws on a second call.
  useEffect(() => {
    const element = wavesurfer?.getMediaElement();
    if (!element) return;

    try {
      graph.current = attachPreview(element);
    } catch (error) {
      // Preview is a convenience; the export is the product. A browser that
      // refuses to route this element must not take the card down with it — and
      // it did exactly that once, during ticket 019's own testing, when a hot
      // reload made `createMediaElementSource` throw. The waveform, the region
      // and the export all still work with no graph at all.
      console.error("Preview could not be attached; playing unprocessed.", error);
      graph.current = null;
    }

    applied.current = "";

    return () => {
      graph.current?.dispose();
      graph.current = null;
      applied.current = "";
    };
  }, [wavesurfer]);

  /** Pushes the current stack into the graph, if anything about it moved. */
  const sync = useCallback(() => {
    if (!graph.current || !region) return;

    const stack = currentStack();
    const effects = track?.previewEffects ?? true;
    const signature = JSON.stringify([stack, effects, [...(measured ?? [])]]);

    if (signature === applied.current) return;
    applied.current = signature;

    graph.current.update({
      region,
      stack,
      measured: measured ?? new Map(),
      effects,
    });
  }, [region, currentStack, track?.previewEffects, measured]);

  useEffect(sync, [sync]);

  // The imperative half. A master default changing must be heard at once and
  // must redraw nothing.
  useEffect(() => useAudioStore.subscribe(sync), [sync]);

  // Keep the envelope in step with a clock this hook does not drive.
  useEffect(() => {
    if (!wavesurfer || !region) return;

    const scheduleFrom = (time: number) =>
      graph.current?.schedule(region, time - region.start);

    const off = [
      wavesurfer.on("play", () => {
        // Pressing play is the user gesture a suspended context waits for.
        void resumePreview().then(() =>
          scheduleFrom(wavesurfer.getCurrentTime())
        );
      }),
      wavesurfer.on("seeking", scheduleFrom),
    ];

    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [wavesurfer, region]);

  const wanted = currentStack().some(needsMeasurement);

  const measure = useCallback(
    async (force: boolean) => {
      if (!track || !region || measuring.current) return;
      if (!currentStack().some(needsMeasurement)) return;
      if (!force && !measuresUnasked(region)) return;

      measuring.current = true;
      setBusy(true);
      try {
        setMeasured(
          await AudioService.measureFor(track, masterExportSettings())
        );
      } finally {
        measuring.current = false;
        setBusy(false);
      }
    },
    [track, region, currentStack]
  );

  // A new file, a new region or a new stack throws the old measurement away and
  // asks for another. `AudioService.measureFor` answers from its cache when the
  // key matches, so an export already paid for this and it returns at once.
  useEffect(() => {
    setMeasured(null);
    void measure(false);
    // Deliberately keyed on what the gain depends on, not on `measure`, which
    // changes identity every render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, region, wanted]);

  return {
    normalized: !wanted || measured !== null,
    measuring: busy,
    awaitingMeasurement: wanted && measured === null,
    tooLongToMeasure: region ? !measuresUnasked(region) : false,
    measureNow: () => void measure(true),
  };
}
