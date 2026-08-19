/**
 * Counts component renders, in development only.
 *
 * Ticket 009 has to prove that redraws dropped. React gives no built-in count
 * that a browser test can read, so components report their own.
 *
 * **Always call it behind the flag**, never bare:
 *
 * ```ts
 * if (import.meta.env.DEV) countRender("AudioEditor");
 * ```
 *
 * Vite replaces `import.meta.env.DEV` with `false` in a production build, so
 * terser drops the whole statement and then the unused import. The cost to a
 * Simple view user is zero bytes. That is checked in the ticket's acceptance,
 * because standing rule 4 says Simple must not regress.
 *
 * Read the counts from a browser console or a test:
 *
 * ```js
 * window.__renders = {};        // reset after the page settles
 * window.__renders             // { "Dashboard": 1, "AudioEditor:clip-30s.mp3": 2 }
 * ```
 */
export function countRender(name: string): void {
  if (!import.meta.env.DEV) return;

  const counts = ((window as RenderCountWindow).__renders ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}

type RenderCountWindow = Window & {
  __renders?: Record<string, number>;
};
