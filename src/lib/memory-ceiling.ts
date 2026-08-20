/**
 * The memory ceiling — 1 GB of encoded audio across the tracks on screen.
 *
 * From [the worker boundary design](../../.wayfinder/designs/worker-boundary.md)
 * section 6. It is a measured rule, not a guess:
 * [015 — Track audio is never released](../../.wayfinder/tickets/015-release-track-audio.md)
 * held ten 50.4 MB files by their blob URLs alone and revoking them released
 * **505.9 MB** against 503.9 MB of file data. **A loaded track costs its whole
 * encoded file, one for one, for as long as its card is mounted.**
 *
 * Two rules, and the second matters as much as the first:
 *
 * - A drop that would cross the line is **refused**, and the reason is shown.
 * - **Nothing is evicted behind the user's back.** A track that is on screen
 *   stays on screen.
 *
 * The decoded half is not counted here, because nothing caches a decoded buffer.
 * One track is decoded at a time, during its own export, and dropped after.
 *
 * Plain functions over `{ name, size }`. No DOM, so Vitest reads this in Node.
 */

/** 1 GB. About twenty 5-minute WAVs, or two 45-minute ones, or many MP3s. */
export const MEMORY_CEILING_BYTES = 1024 * 1024 * 1024;

/** The one field this rule reads. A `File` satisfies it. */
export type SizedFile = { name: string; size: number };

export type Admission<T extends SizedFile> = {
  /** The files that fit, in the order they arrived. */
  accepted: T[];
  /** The files turned away, in the order they arrived. */
  refused: T[];
  /** Encoded bytes held after this admission. */
  totalBytes: number;
};

export function totalBytes(files: SizedFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

/**
 * Decides which of `incoming` may join `existing`.
 *
 * Files already on screen are never refused, however far over the line they
 * are. Refusing them would be eviction, and eviction is what this design says
 * not to do. A ceiling lowered under a loaded workspace therefore refuses every
 * new drop and touches nothing already there.
 *
 * Each incoming file is judged in order. A large file that does not fit does
 * not block a small one behind it — the user dropped both, and getting one is
 * better than getting neither.
 */
export function admit<T extends SizedFile>(
  existing: SizedFile[],
  incoming: T[],
  ceilingBytes: number = MEMORY_CEILING_BYTES
): Admission<T> {
  let held = totalBytes(existing);

  const accepted: T[] = [];
  const refused: T[] = [];

  for (const file of incoming) {
    if (held + file.size > ceilingBytes) {
      refused.push(file);
      continue;
    }
    held += file.size;
    accepted.push(file);
  }

  return { accepted, refused, totalBytes: held };
}

/** "1.4 GB", "503.9 MB", "5.0 MB". One decimal, always. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}
