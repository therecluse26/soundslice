import { RefObject, useEffect, useMemo, useState } from "react";
import WaveSurfer, { WaveSurferOptions } from "wavesurfer.js";

/**
 * Creates one wavesurfer instance for a container, and destroys it on unmount.
 *
 * ## Why this is not `useWavesurfer` from `@wavesurfer/react`
 *
 * That hook does two things. It creates the instance — which is what a card
 * wants — and it keeps `isReady`, `isPlaying` and `currentTime` in React state
 * beside it, which no card here reads. From its own shipped source:
 *
 * ```js
 * t.on("timeupdate", (() => { u(t.getCurrentTime()) }))
 * ```
 *
 * `timeupdate` fires as fast as the page can paint, so **every playing card
 * re-rendered about sixty times a second** for a value nothing reads. Measured
 * over three seconds of playback: **382 renders**. The card already keeps the
 * playhead in `currentTimeRef`, which is a ref and costs nothing.
 *
 * The library exports the state hook and the component, but not the instance
 * half on its own, so this is that half. Ticket 020.
 *
 * ## The dependency array
 *
 * Flattening the options into the array is the library's own trick, and it is
 * load-bearing. The card builds its options object inline, so a fresh identity
 * arrives on every render; comparing the flattened **values** means the instance
 * is rebuilt only when a setting really changes. Its length is stable because
 * the key set is.
 */
export function useWavesurferInstance(
  container: RefObject<HTMLElement>,
  options: Omit<WaveSurferOptions, "container">
): WaveSurfer | null {
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
  const values = useMemo(() => Object.entries(options).flat(), [options]);

  useEffect(() => {
    if (!container.current) return;

    const instance = WaveSurfer.create({
      ...options,
      container: container.current,
    });

    setWavesurfer(instance);
    return () => instance.destroy();
    // `values` is spread deliberately — see the note above. `options` itself is
    // a new object every render and would rebuild the waveform each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, ...values]);

  return wavesurfer;
}
