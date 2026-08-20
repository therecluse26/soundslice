/**
 * The four colours the waveform draws with.
 *
 * These used to come from `resolveConfig(tailwindConfig)`, evaluated at runtime
 * inside `AudioEditor`. That pulled the whole Tailwind default palette into the
 * Simple view bundle — `cyan`, `rose`, `lime`, `fuchsia` and `emerald` all
 * shipped, and the app draws with none of them. See
 * [014](../../.wayfinder/tickets/014-tailwind-config-in-simple-bundle.md).
 *
 * The values are Tailwind 3's defaults, copied byte-for-byte. `tailwind.config.ts`
 * extends `colors` but overrides neither `gray` nor `red`, so these are exactly
 * what `resolveConfig` returned:
 *
 * ```sh
 * node -e "const c=require('tailwindcss/colors'); console.log(c.gray[700], c.gray[400], c.red[500])"
 * # #374151 #9ca3af #ef4444
 * ```
 *
 * They are literals, not CSS custom properties, because wavesurfer draws to a
 * canvas and needs a real colour string, not a `var(--…)` reference.
 *
 * `tailwind.config.ts` is still needed at build time by PostCSS. This file only
 * takes it out of the **runtime** bundle.
 */
export const WAVEFORM_COLORS = {
  /** tailwind gray-700 — the unplayed waveform on a dark background */
  waveDark: "#374151",
  /** tailwind gray-400 — the unplayed waveform on a light background */
  waveLight: "#9ca3af",
  /** tailwind red-500 — the played part, in both themes */
  progress: "#ef4444",
} as const;

/**
 * The two shades a region is drawn in.
 *
 * `region` is the exact colour every region has had since before this map
 * existed. `selected` is the same hue, a little more opaque, because a track can
 * now hold six and the play button plays exactly one of them.
 *
 * Opacity, not a different hue: a region is an overlay, and the waveform has to
 * stay readable through it. Half opacity was tried and washed the waveform out.
 *
 * **Simple view never uses `selected`.** It draws one region, so there is
 * nothing to tell apart, and using it would change how Simple has always looked
 * for no gain. Standing rule 4.
 */
export const REGION_COLORS = {
  region: "rgba(254, 242, 242, 0.25)",
  selected: "rgba(254, 242, 242, 0.38)",
} as const;
