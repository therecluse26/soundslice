import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions";
import { useTransientSnap } from "@/hooks/useTransientSnap";

/**
 * The transient magnet, as a component that draws nothing.
 *
 * `useTransientSnap` reaches onset detection, which reaches the decoder and both
 * detection modules. Calling it from `AudioEditor` put all of that in the Simple
 * bundle — **+4.99 KiB gzip, measured** — for a tool Simple view cannot switch
 * on. Standing rule 6 says a Simple user downloads none of it.
 *
 * A hook cannot be called conditionally; a component can be rendered
 * conditionally. So the hook lives behind this, `AudioEditor` imports it
 * dynamically, and it is rendered only in Advanced view. The magnet stops when
 * the view switches, because the hook's effects clean up on unmount.
 *
 * It must have a default export, because `React.lazy` requires one.
 */
export default function RegionMagnet({
  wavesurfer,
  regionsPlugin,
  file,
}: {
  wavesurfer: WaveSurfer | null;
  regionsPlugin: RegionsPlugin;
  file: File;
}) {
  useTransientSnap(wavesurfer, regionsPlugin, file);
  return null;
}
