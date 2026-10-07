import { createContext, useContext } from "react";

/**
 * True inside a panel too narrow for side-by-side controls — Advanced view's
 * inspector, about 340 px wide.
 *
 * A context and not a media query, because the panel is narrow on the widest
 * screen. Editors that lay a picture beside their sliders stack them instead.
 */
export const NarrowPanel = createContext(false);

export function useNarrowPanel(): boolean {
  return useContext(NarrowPanel);
}
