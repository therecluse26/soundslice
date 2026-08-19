# 014 — The whole Tailwind config ships in the Simple bundle

**Type:** `wayfinder:task`
**Status:** closed
**Assignee:** agent session 2026-08-19 (build sweep)
**Blocked by:** none
**Blocks:** _none_
**Map:** [Simple view and Advanced view](../map.md)

## Question

Can the waveform colours be read without bundling every Tailwind colour into the
Simple view path?

Found while measuring the bundle for
[012 — View state, toggle and the lazy-load boundary](./012-view-state-and-toggle.md).

## The defect

`AudioEditor` imports the entire Tailwind config and resolves it at runtime:

```ts
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../../tailwind.config";
...
const resolvedConfig = resolveConfig(tailwindConfig);
const { colors } = resolvedConfig.theme;
```

It uses exactly four values, at `AudioEditor.tsx:99` and `:100`:
`colors.gray[700]`, `colors.gray[400]`, and `colors.red[500]` twice.

The cost is the whole default palette in the main chunk. Counted in the built
bundle, these appear even though the app never uses them:

| Colour | Occurrences in the Simple bundle |
|---|---|
| `cyan` | 9 |
| `rose` | 6 |
| `lime` | 5 |
| `fuchsia` | 4 |
| `emerald` | 3 |

`AudioEditor` is on the Simple path, so every Simple user downloads all of it.

## The work

1. Replace the runtime `resolveConfig` with the four values the component needs.
   Read them from a small module, or from CSS custom properties already on the
   page.
2. Confirm the waveform looks unchanged in both themes. Note that the theme is
   forced to dark today, in `src/contexts/ThemeContext.tsx`.
3. Measure the bundle before and after. Record both numbers.

## Watch for

`tailwind.config.ts` is still needed at build time by PostCSS. This ticket only
removes it from the **runtime** bundle. Do not delete the file.

The colours are currently chosen by a `theme === "dark"` check. That check is
dead while the theme is forced, but do not remove it here — reviving light theme
is a separate decision, and this ticket is only about bundle size.

## Acceptance

The Simple view bundle shrinks. `cyan`, `rose`, `lime`, `fuchsia` and `emerald`
no longer appear in it. The waveform renders in the same colours as before.

---

## Resolution — 2026-08-19

**Yes.** The Simple bundle is **18.4 KiB gzip smaller**, and the waveform draws
in exactly the same colour, proved pixel by pixel.

### The change

`AudioEditor` no longer imports `tailwindcss/resolveConfig` or
`tailwind.config`. It imports `src/lib/waveform-colors.ts`, which holds the three
values it actually uses as literals:

| Name | Value | Was |
|---|---|---|
| `waveDark` | `#374151` | `colors.gray[700]` |
| `waveLight` | `#9ca3af` | `colors.gray[400]` |
| `progress` | `#ef4444` | `colors.red[500]`, in both branches |

Three, not four. `red[500]` appeared twice in one ternary with the same value on
both sides. The branch is kept, because the ticket says not to touch the dead
`theme === "dark"` check here.

They are safe to hard-code because `tailwind.config.ts` extends `colors` but
overrides neither `gray` nor `red`. Checked, not assumed:

```sh
$ node -e "const c=require('tailwindcss/colors'); console.log(c.gray[700], c.gray[400], c.red[500])"
#374151 #9ca3af #ef4444
```

They are literals rather than CSS custom properties because wavesurfer draws to a
canvas, which needs a real colour string, not a `var(--…)` reference.

### The bundle, before and after

| Asset | Before | After | Saved |
|---|---|---|---|
| `dist/assets/index.*.js` raw | 515,750 B | 452,617 B | **63,133 B** |
| `dist/assets/index.*.js` gzip | 158,744 B | 139,899 B | **18,845 B (18.4 KiB)** |

For scale: the whole lazy-loaded Advanced chunk is 2,713 B gzip. This one import
cost seven times the entire Advanced view.

### The acceptance, checked

The five named colours are gone from the Simple bundle:

| Colour | Before | After |
|---|---|---|
| `cyan` | 9 | **0** |
| `rose` | 6 | **0** |
| `lime` | 5 | **0** |
| `fuchsia` | 4 | **0** |
| `emerald` | 3 | **0** |

Two string matches remain and neither is Tailwind's palette: `"prose"` inside
`tailwind-merge`'s class-group table, and `amber-500` as a CSS class name in a
component. The stronger test is the palette's hex values, all absent:

| Hex | Colour | Occurrences |
|---|---|---|
| `#06b6d4` | cyan-500 | 0 |
| `#f43f5e` | rose-500 | 0 |
| `#84cc16` | lime-500 | 0 |
| `#d946ef` | fuchsia-500 | 0 |
| `#10b981` | emerald-500 | 0 |
| `#f59e0b` | amber-500 | 0 |

And the three we keep appear exactly once each: `#374151`, `#9ca3af`, `#ef4444`.

### The waveform is the same colour

Not judged by eye. The first card's canvas was read back pixel by pixel in
Chromium, and every fully-opaque pixel tallied:

```
canvas 1285 x 100 — one colour, 3174 pixels: #9ca3af
```

`#9ca3af` is `WAVEFORM_COLORS.waveLight`, which is `colors.gray[400]`, which is
what `resolveConfig` returned before. Same input, same mapping, same output.

### A finding: the dark branch is dead

The waveform draws in the **light** colour, on a page whose theme is forced dark.

`ThemeContext` defaults its value to the string `"system"`
(`src/contexts/ThemeContext.tsx:15`), not `"dark"`. So `theme === "dark"` has
always been false and `colors.gray[400]` has always been the colour on screen.
The `gray[700]` branch has never run.

Left exactly as it is, because this ticket says so: reviving light theme is a
separate decision. Recorded here so whoever takes that decision knows the dark
branch is untested, not merely unused.

`tailwind.config.ts` is untouched. PostCSS still needs it at build time.
