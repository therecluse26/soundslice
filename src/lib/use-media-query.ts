import { useEffect, useState } from "react";

function readMatch(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/**
 * Reports whether a media query matches, and keeps reporting as it changes.
 *
 * Two fixes over the previous version, both required by ticket 012:
 *
 * 1. The first render reads the query. It used to start at `false`, so the
 *    first paint claimed every screen was wide, even a phone, and the layout
 *    flashed before correcting.
 * 2. It listens to the media query itself, not the window `resize` event. A
 *    query can change without a resize — rotating a tablet, or a change of
 *    display — and `resize` misses those.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatch(query));

  useEffect(() => {
    const media = window.matchMedia(query);

    // Re-read on mount, in case the query changed between render and effect.
    setMatches(media.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
