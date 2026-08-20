import { useEffect, useRef } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions";
import { useAudioStore } from "@/stores/audio-store";
import { cachedTransients, ensureTransients } from "@/lib/region-tools";
import { SNAP_RADIUS_PX, nearestTransient } from "@/lib/transients";

/**
 * The transient magnet, on a drag.
 *
 * **Snap is not a button.** It does not move existing edges and it makes no
 * regions of its own. While it is on, every edge the user drags lands on the
 * start of a sound — the same way grid snap works in every other editor, and for
 * the same reason: it helps every gesture instead of one.
 *
 * ## Where it has to run
 *
 * wavesurfer has **no snap hook**. The only place to intervene is
 * `region-update`, which fires on every frame of a drag with the side being
 * dragged, and the only way to write back is `region.setOptions()`.
 *
 * That is safe, and it is safe for a checkable reason: `setOptions` emits
 * nothing. Read the plugin source — it sets `start`, `end` and `color`, calls
 * `renderPosition()`, and never touches the emitter. So writing during `update`
 * cannot re-enter this handler and cannot fight the drag it is inside. The next
 * frame applies the pointer delta to the snapped value, which is exactly what a
 * magnet should feel like: the edge sticks until the pointer pulls it free.
 *
 * ## Detection runs once per track
 *
 * `region-update` fires continuously, so nothing here may scan. The times are
 * read from the cache and the magnet simply does nothing until they are there.
 * Turning the switch on starts the one scan, off the drag path entirely.
 *
 * ## It is mounted only in Advanced view
 *
 * This hook reaches onset detection, which reaches the decoder. Calling it from
 * `AudioEditor` put all of that in the Simple bundle — **+4.99 KiB gzip,
 * measured** — for a tool Simple view cannot switch on. It is reached through
 * `RegionMagnet`, which `AudioEditor` imports dynamically. Standing rule 6.
 *
 * ## Escaping the magnet
 *
 * Hold **Alt** and the magnet lets go for as long as it is held. A user must be
 * able to put an edge where there is no transient.
 */
export function useTransientSnap(
  wavesurfer: WaveSurfer | null,
  regionsPlugin: RegionsPlugin,
  file: File
): void {
  const escaping = useRef(false);

  // Alt suspends the magnet. Read from a ref, because `region-update` fires
  // dozens of times a second and a piece of React state would redraw the card
  // every time the key moved.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      escaping.current = event.altKey;
    };
    const onBlur = () => {
      escaping.current = false;
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Scan when the switch goes on, and never on the drag path.
  //
  // Watched with `subscribe`, not with a selector. A selector would redraw this
  // card whenever any part of the store moved, which is the redraw storm ticket
  // 009 removed — and `usePreview` watches the store the same way for the same
  // reason.
  useEffect(() => {
    const scanIfWanted = () => {
      if (!useAudioStore.getState().snapToTransients) return;
      if (cachedTransients(file)) return;
      void ensureTransients(file);
    };

    scanIfWanted();
    return useAudioStore.subscribe(scanIfWanted);
  }, [file]);

  useEffect(() => {
    if (!wavesurfer) return;

    return regionsPlugin.on("region-update", (region, side) => {
      if (!useAudioStore.getState().snapToTransients) return;
      if (escaping.current) return;

      const times = cachedTransients(file);
      if (!times || times.length === 0) return;

      const radiusSec = SNAP_RADIUS_PX / pixelsPerSecond(wavesurfer);
      if (!Number.isFinite(radiusSec) || radiusSec <= 0) return;

      if (side === "start" || side === "end") {
        const edge = side === "start" ? region.start : region.end;
        const landed = nearestTransient(times, edge, radiusSec);

        if (landed === null || landed === edge) return;
        region.setOptions(
          side === "start" ? { start: landed } : { start: region.start, end: landed }
        );
        return;
      }

      // No side means the whole region moved. Snap its start and carry the end
      // with it, so a move keeps the region's length — a magnet that stretched a
      // region while moving it would be a different tool.
      const landed = nearestTransient(times, region.start, radiusSec);
      if (landed === null || landed === region.start) return;

      region.setOptions({
        start: landed,
        end: landed + (region.end - region.start),
      });
    });
  }, [wavesurfer, regionsPlugin, file]);
}

/**
 * How many pixels one second of audio occupies right now.
 *
 * Read from the wrapper rather than from `minPxPerSec`, because the zoom slider
 * changes the drawn width and the option is only its starting point. This is the
 * same width the plugin itself divides by when it turns a pointer delta into
 * seconds, so the radius means the same thing to both.
 */
function pixelsPerSecond(wavesurfer: WaveSurfer): number {
  const duration = wavesurfer.getDuration();
  if (!(duration > 0)) return 0;

  return wavesurfer.getWrapper().getBoundingClientRect().width / duration;
}
