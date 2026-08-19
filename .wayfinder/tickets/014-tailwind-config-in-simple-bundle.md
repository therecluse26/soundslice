# 014 — The whole Tailwind config ships in the Simple bundle

**Type:** `wayfinder:task`
**Status:** open
**Assignee:** _unclaimed_
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
