/**
 * Namespaced, versioned `localStorage` helpers.
 *
 * Every key this app writes carries the `soundslice:` prefix. The app deploys to
 * GitHub Pages, which serves every site under one account from a single origin.
 * That means one shared `localStorage`, so an unprefixed key such as `view` can
 * collide with an unrelated project.
 *
 * Every stored value carries a version. An unknown version is discarded, not
 * migrated. This is a free tool with no accounts, so a clean reset beats a
 * migration path nobody will test.
 *
 * Both helpers swallow their errors. `localStorage` throws in some private
 * browsing modes, and stored text can be edited by hand. Losing a preference is
 * acceptable; crashing the editor is not.
 *
 * Decided in `.wayfinder/designs/view-state.md`, section 1.
 */

const PREFIX = "soundslice:";

type Envelope = { v: number; value: unknown };

export function readPersisted<T>(
  key: string,
  version: number,
  isValid: (value: unknown) => value is T
): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Envelope | null;
    if (!parsed || parsed.v !== version) return null;

    return isValid(parsed.value) ? parsed.value : null;
  } catch {
    return null;
  }
}

export function writePersisted(key: string, version: number, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: version, value }));
  } catch {
    // Storage full, or blocked by the browser. Nothing to do.
  }
}
