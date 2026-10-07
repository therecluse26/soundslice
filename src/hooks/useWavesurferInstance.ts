import { RefObject, useEffect, useMemo, useRef, useState } from "react";
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
 * ## Built once; restyled in place
 *
 * The instance is built again **only when the file or the plugins change**.
 * Every other option — height, bar width, colours — is handed to the live
 * instance with `setOptions`.
 *
 * It used to rebuild on any option change, and the card's height and bar width
 * change at the 800 px phone breakpoint. A rebuilt instance has no audio until
 * it decodes again, so the card redrew its regions onto a waveform 0 s long,
 * the regions plugin clamped every one to 0–0, and the card wrote that back to
 * the store as the truth. Turning a phone sideways erased the user's regions.
 * Found by ticket 033's browser checks.
 *
 * The values are compared flattened, the library's own trick: the card builds
 * its options inline, so a fresh object arrives on every render, and comparing
 * the values is what stops that from counting as a change.
 */
export function useWavesurferInstance(
  container: RefObject<HTMLElement>,
  options: Omit<WaveSurferOptions, "container">
): WaveSurfer | null {
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
  const { url, plugins, ...style } = options;
  const styleValues = useMemo(() => Object.entries(style).flat(), [style]);

  // The latest style, for the instance built below. A ref, so a style change
  // alone never re-runs the build.
  const latestStyle = useRef(style);
  latestStyle.current = style;

  useEffect(() => {
    if (!container.current) return;

    const instance = WaveSurfer.create({
      ...latestStyle.current,
      url,
      plugins,
      container: container.current,
    });

    setWavesurfer(instance);
    return () => instance.destroy();
  }, [container, url, plugins]);

  useEffect(() => {
    wavesurfer?.setOptions(latestStyle.current);
    // `styleValues` is the comparison; `latestStyle` is what is applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wavesurfer, ...styleValues]);

  return wavesurfer;
}
