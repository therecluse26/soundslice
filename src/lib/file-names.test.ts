import { describe, expect, it } from "vitest";
import { outputFileName, stemOf, uniqueFileName } from "./file-names";

describe("stemOf", () => {
  it("drops the extension", () => {
    expect(stemOf("interview.wav")).toBe("interview");
  });

  it("drops only the last extension", () => {
    expect(stemOf("take.1.final.mp3")).toBe("take.1.final");
  });

  it("keeps a name that has no extension", () => {
    expect(stemOf("recording")).toBe("recording");
  });

  it("keeps a dotfile whole, because its dot is not an extension", () => {
    // The old `split(".").slice(0, -1).join(".")` returned "" here, and the
    // fallback then handed back the whole name anyway. This is that, directly.
    expect(stemOf(".hidden")).toBe(".hidden");
  });
});

describe("outputFileName", () => {
  it("prefixes and re-extends", () => {
    expect(outputFileName("interview.mp3", "wav")).toBe("sliced_interview.wav");
  });

  it("takes a different prefix", () => {
    expect(outputFileName("interview.mp3", "wav", "trimmed_")).toBe(
      "trimmed_interview.wav"
    );
  });
});

describe("uniqueFileName", () => {
  it("passes a fresh name through unchanged", () => {
    const taken = new Set<string>();
    expect(uniqueFileName(taken, "sliced_a.wav")).toBe("sliced_a.wav");
  });

  it("numbers a clash before the extension", () => {
    // The real case: `clip-30s.wav` and `clip-30s.mp3` exported as WAV both
    // want `sliced_clip-30s.wav`. JSZip overwrote silently, so a three-track
    // export came back as a two-file zip.
    const taken = new Set<string>();
    uniqueFileName(taken, "sliced_clip-30s.wav");
    expect(uniqueFileName(taken, "sliced_clip-30s.wav")).toBe(
      "sliced_clip-30s (2).wav"
    );
  });

  it("keeps counting past the second clash", () => {
    const taken = new Set<string>();
    const names = [1, 2, 3, 4].map(() => uniqueFileName(taken, "x.wav"));
    expect(names).toEqual(["x.wav", "x (2).wav", "x (3).wav", "x (4).wav"]);
  });

  it("does not collide with a name a user already numbered", () => {
    const taken = new Set(["x.wav", "x (2).wav"]);
    expect(uniqueFileName(taken, "x.wav")).toBe("x (3).wav");
  });

  it("numbers a name with no extension", () => {
    const taken = new Set(["recording"]);
    expect(uniqueFileName(taken, "recording")).toBe("recording (2)");
  });
});
