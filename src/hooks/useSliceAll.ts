import { useState } from "react";
import { masterExportSettings, useAudioStore } from "@/stores/audio-store";
import { AudioService } from "@/lib/audio-service";
import { downloadBlob } from "@/lib/download";
import { exportableTrack } from "@/lib/advanced-settings";
import { useEffectiveView } from "@/hooks/useEffectiveView";

/**
 * **Slice All Files**: every track, into one zip.
 *
 * One handler for both places the button lives — the master toolbar in Simple
 * view and the track list in Advanced view — so the two can never export
 * different things.
 *
 * Returns whether an export is running and the function that starts one.
 */
export function useSliceAll(): { downloading: boolean; sliceAll: () => Promise<void> } {
  const view = useEffectiveView();
  const setProcessingLoading = useAudioStore(
    (state) => state.setProcessingLoading
  );
  const setSliceProgress = useAudioStore((state) => state.setSliceProgress);
  const setExportController = useAudioStore(
    (state) => state.setExportController
  );

  const [downloading, setDownloading] = useState(false);

  const sliceAll = async () => {
    setDownloading(true);
    setProcessingLoading(true);
    setSliceProgress(null);

    // The overlay's Cancel reads this from the store. Ticket 035.
    const controller = new AbortController();
    setExportController(controller);

    try {
      // **The same rule the card's own button applies.** In Simple view a track
      // exports the one region it draws, and `designs/view-state.md` §4 says
      // that applies to *both* export paths.
      const zip = await AudioService.sliceAllFilesIntoZip(
        useAudioStore
          .getState()
          .tracks.map((track) => exportableTrack(track, view)),
        masterExportSettings(),
        { onProgress: setSliceProgress, signal: controller.signal }
      );

      // Cancelled: nothing is downloaded, and no half-built zip exists.
      if (!zip || controller.signal.aborted) return;

      // The zip is the only export blob that ever becomes a URL, and
      // `downloadBlob` revokes it. Every file inside it went in as a `Blob`.
      downloadBlob(zip, "sliced-audio.zip");
    } finally {
      setExportController(null);
      setSliceProgress(null);
      setProcessingLoading(false);
      setDownloading(false);
    }
  };

  return { downloading, sliceAll };
}
