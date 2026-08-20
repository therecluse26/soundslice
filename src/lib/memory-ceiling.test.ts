import { describe, expect, it } from "vitest";
import {
  MEMORY_CEILING_BYTES,
  admit,
  formatBytes,
  totalBytes,
} from "./memory-ceiling";

const MB = 1024 * 1024;

/** A stand-in for a `File`. Only `name` and `size` are read. */
const file = (name: string, sizeMb: number) => ({ name, size: sizeMb * MB });

describe("admit", () => {
  it("takes everything that fits", () => {
    const { accepted, refused } = admit([], [file("a.wav", 50), file("b.wav", 50)]);
    expect(accepted.map((f) => f.name)).toEqual(["a.wav", "b.wav"]);
    expect(refused).toEqual([]);
  });

  it("counts what is already loaded", () => {
    // Ticket 015 measured this: revoking ten 50.4 MB blob URLs released
    // 505.9 MB. A loaded track costs its whole encoded file, one for one.
    const existing = [file("held.wav", 900)];
    const { accepted, refused } = admit(existing, [file("new.wav", 200)]);
    expect(accepted).toEqual([]);
    expect(refused.map((f) => f.name)).toEqual(["new.wav"]);
  });

  it("never removes a file already on screen", () => {
    // The design's second rule, and the one a naive cache would break: refuse,
    // never evict. Even far over the line, what is loaded stays loaded.
    const existing = [file("huge.wav", 2000)];
    const { accepted, refused, totalBytes: held } = admit(existing, [
      file("small.wav", 1),
    ]);
    expect(accepted).toEqual([]);
    expect(refused).toHaveLength(1);
    expect(held).toBe(2000 * MB);
  });

  it("lets a small file through behind a large one that did not fit", () => {
    // The user dropped both. Getting one is better than getting neither.
    const { accepted, refused } = admit(
      [],
      [file("big.wav", 2000), file("small.wav", 10)]
    );
    expect(accepted.map((f) => f.name)).toEqual(["small.wav"]);
    expect(refused.map((f) => f.name)).toEqual(["big.wav"]);
  });

  it("accepts a file that lands exactly on the ceiling", () => {
    const { accepted } = admit([], [{ name: "exact", size: MEMORY_CEILING_BYTES }]);
    expect(accepted).toHaveLength(1);
  });

  it("refuses a file one byte over", () => {
    const { refused } = admit([], [
      { name: "over", size: MEMORY_CEILING_BYTES + 1 },
    ]);
    expect(refused).toHaveLength(1);
  });

  it("holds about twenty 5-minute WAVs", () => {
    // The design's own sanity check on the number: 1 GB buys roughly twenty
    // `track-5m.wav`, which is 50.4 MB each.
    const files = Array.from({ length: 30 }, (_, i) => file(`t${i}.wav`, 50.4));
    expect(admit([], files).accepted).toHaveLength(20);
  });
});

describe("totalBytes", () => {
  it("is zero for nothing", () => {
    expect(totalBytes([])).toBe(0);
  });
});

describe("formatBytes", () => {
  it("uses MB below a gigabyte", () => {
    expect(formatBytes(503.9 * MB)).toBe("503.9 MB");
  });

  it("uses GB at a gigabyte and above", () => {
    expect(formatBytes(MEMORY_CEILING_BYTES)).toBe("1.0 GB");
  });
});
