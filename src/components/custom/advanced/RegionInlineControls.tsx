import { useEffect, useRef } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions";
import type { Region as WaveSurferRegion } from "wavesurfer.js/dist/plugins/regions";
import { selectedRegion, useAudioStore } from "@/stores/audio-store";
import type { TrackRegion } from "@/stores/audio-store";
import { orderedRegions, regionLabel } from "@/lib/edit-stack";
import {
  RegionOverlay,
  createRegionOverlay,
} from "@/lib/region-overlay";

/**
 * Puts a region's gain, fades, name and delete **on the region**.
 *
 * Draws nothing of its own. It hangs an overlay on each wavesurfer region
 * element and keeps it in step with the store, the way `RegionMagnet` hangs a
 * behaviour on a drag.
 *
 * ## Why it listens to the plugin as well as to the store
 *
 * This is a child of `AudioEditor`, and React runs a child's effects **before**
 * its parent's. So on the commit that adds a region to the store, this effect
 * runs before the card's reconciler has made the wavesurfer region to hang an
 * overlay on. Listening to `region-created` closes that gap, and makes the order
 * stop mattering.
 *
 * ## Advanced only, and lazy
 *
 * Reached through a dynamic import in `AudioEditor`, so a Simple view user
 * downloads none of it. Standing rule 6. Simple view draws one region and has no
 * controls for it, which is what it has always had.
 */
export default function RegionInlineControls({
  wavesurfer,
  regionsPlugin,
  fileName,
}: {
  wavesurfer: WaveSurfer | null;
  regionsPlugin: RegionsPlugin;
  fileName: string;
}) {
  const track = useAudioStore((state) =>
    state.tracks.find((t) => t.file.name === fileName)
  );
  const updateTrackRegion = useAudioStore((state) => state.updateTrackRegion);
  const removeTrackRegion = useAudioStore((state) => state.removeTrackRegion);

  const regions = track?.regions;
  const selectedId = selectedRegion(track)?.id;

  const overlays = useRef(new Map<string, RegionOverlay>());

  /**
   * Which gesture the drags are in.
   *
   * A drag on a fade grip fires on every frame, and every one of those must be
   * heard at once. They are one gesture, so they share a coalesce key and become
   * one undo entry. Letting go bumps this number, so the next drag of the same
   * grip undoes separately.
   *
   * A ref, not state. Changing it must redraw nothing.
   */
  const gesture = useRef(0);

  // The handlers are read through a ref, so an overlay made once never holds a
  // stale `fileName` or a stale store action.
  const act = useRef({ fileName, updateTrackRegion, removeTrackRegion });
  act.current = { fileName, updateTrackRegion, removeTrackRegion };

  // What the overlays should be showing, read at the moment one is attached.
  //
  // Set during render, so it is already current when any effect runs. An
  // overlay attached from `region-created` cannot wait for the next redraw:
  // that redraw already ran, **before** the card made the region to hang it on.
  // Without this an overlay drew nothing — no name, no gain line, no fade grips
  // in the right places — until something else changed.
  const latest = useRef<{ regions: TrackRegion[]; selectedId?: string }>({
    regions: [],
    selectedId: undefined,
  });
  latest.current = { regions: regions ?? [], selectedId };

  /** Redraws one overlay from what the store holds right now. */
  const draw = (overlay: RegionOverlay, id: string) => {
    const list = orderedRegions(latest.current.regions);
    const region = list.find((one) => one.id === id);

    if (region) overlay.update(viewOf(region, list, latest.current.selectedId));
  };

  useEffect(() => {
    if (!wavesurfer) return;

    const attach = (region: WaveSurferRegion) => {
      if (overlays.current.has(region.id)) return;

      const coalesce = (what: string) =>
        `${what}:${act.current.fileName}:${region.id}:${gesture.current}`;

      const overlay = createRegionOverlay(region.element, {
          onGain: (gainDb, phase) => {
            act.current.updateTrackRegion(
              act.current.fileName,
              region.id,
              { gainDb },
              { label: "Region gain", coalesceKey: coalesce("gain") }
            );
            if (phase === "end") gesture.current += 1;
          },

          onFade: (fade, phase) => {
            act.current.updateTrackRegion(
              act.current.fileName,
              region.id,
              { fade },
              { label: "Region fade", coalesceKey: coalesce("fade") }
            );
            if (phase === "end") gesture.current += 1;
          },

          onRename: (name) => {
            act.current.updateTrackRegion(
              act.current.fileName,
              region.id,
              { name: name || undefined },
              { label: "Rename region" }
            );
          },

          onDelete: () => {
            act.current.removeTrackRegion(act.current.fileName, region.id);
          },
      });

      overlays.current.set(region.id, overlay);
      draw(overlay, region.id);
    };

    const detach = (id: string) => {
      overlays.current.get(id)?.destroy();
      overlays.current.delete(id);
    };

    // Whatever the card has already drawn, plus everything it draws later.
    regionsPlugin.getRegions().forEach(attach);

    const off = [
      regionsPlugin.on("region-created", attach),
      regionsPlugin.on("region-removed", (region) => detach(region.id)),
    ];

    const drawn = overlays.current;

    return () => {
      off.forEach((unsubscribe) => unsubscribe());
      drawn.forEach((overlay) => overlay.destroy());
      drawn.clear();
    };
  }, [wavesurfer, regionsPlugin]);

  // Redraw the overlays from the store.
  //
  // Also on `zoom`, `redraw` and `region-updated`, because a fade is drawn in
  // pixels and all three change how many pixels a second is worth. Without them
  // a zoomed waveform would show yesterday's fade widths.
  useEffect(() => {
    if (!wavesurfer) return;

    const redraw = () => {
      for (const [id, overlay] of overlays.current) draw(overlay, id);
    };

    redraw();

    const off = [
      wavesurfer.on("zoom", redraw),
      wavesurfer.on("redraw", redraw),
      regionsPlugin.on("region-updated", redraw),
    ];

    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [wavesurfer, regionsPlugin, regions, selectedId]);

  return null;
}

function viewOf(
  region: TrackRegion,
  all: TrackRegion[],
  selectedId: string | undefined
) {
  return {
    label: regionLabel(all, region),
    gainDb: region.gainDb,
    fade: region.fade,
    durationSec: Math.max(0, region.end - region.start),
    selected: region.id === selectedId,
  };
}
