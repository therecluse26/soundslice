/**
 * The view vocabulary.
 *
 * A **view** is which set of controls is on screen: Simple view or Advanced
 * view. It is not a theme. `mode` already means theme in
 * `src/components/mode-toggle.tsx`, so this file never uses that word.
 *
 * Decided in `.wayfinder/designs/view-state.md`.
 */

export type View = "simple" | "advanced";

/** New visitors get Simple view. */
export const DEFAULT_VIEW: View = "simple";

export const VIEW_STORAGE_KEY = "view";
export const VIEW_STORAGE_VERSION = 1;

/**
 * Advanced view needs room. Below this width the effective view is always
 * Simple, and the toggle is hidden.
 *
 * The stored view is never rewritten by screen size. Someone who chose Advanced
 * on a desktop still has Advanced when they return to one.
 */
export const ADVANCED_MIN_WIDTH_PX = 800;
export const ADVANCED_MEDIA_QUERY = `(min-width: ${ADVANCED_MIN_WIDTH_PX}px)`;

export function isView(value: unknown): value is View {
  return value === "simple" || value === "advanced";
}

/**
 * The view actually in force, as opposed to the one that is stored.
 *
 * Kept as a plain function so it can be tested without React.
 */
export function effectiveView(storedView: View, screenIsWideEnough: boolean): View {
  return screenIsWideEnough ? storedView : "simple";
}
