import { describe, expect, it } from "vitest";
import {
  outputFileName,
  regionFileName,
  sanitizeNamePart,
  stemOf,
  uniqueFileName,
} from "./file-names";

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

describe("sanitizeNamePart", () => {
  it("keeps an ordinary name whole", () => {
    expect(sanitizeNamePart("chorus 2")).toBe("chorus 2");
  });

  it("keeps digits and hyphens", () => {
    // A character class written as `[\x20-\x3c...]` looks right and is a range
    // that eats every digit. This is the test that catches it.
    expect(sanitizeNamePart("take-3 v2")).toBe("take-3 v2");
  });

  it("turns a slash into a hyphen, so it cannot make a directory", () => {
    expect(sanitizeNamePart("verse/chorus")).toBe("verse-chorus");
  });

  it("turns a backslash and a colon into hyphens", () => {
    expect(sanitizeNamePart("a\\b:c")).toBe("a-b-c");
  });

  it("replaces a null byte, which could truncate the name where it is used", () => {
    const nul = String.fromCharCode(0);
    expect(sanitizeNamePart(`safe${nul}name`)).toBe("safe-name");
  });

  it("replaces a tab, which is whitespace a file name should not carry", () => {
    expect(sanitizeNamePart("a\tb")).toBe("a-b");
  });

  it("drops the characters Windows refuses outright", () => {
    expect(sanitizeNamePart('a<b>c"d|e?f*g')).toBe("a-b-c-d-e-f-g");
  });

  it("drops a trailing dot, which Windows strips silently", () => {
    // Two names differing only by a trailing dot would become one file.
    expect(sanitizeNamePart("outro.")).toBe("outro");
  });

  it("drops leading and trailing spaces", () => {
    expect(sanitizeNamePart("  intro  ")).toBe("intro");
  });

  it("caps the length, so the path can still be written", () => {
    expect(sanitizeNamePart("x".repeat(200))).toHaveLength(64);
  });

  it("returns nothing for a name that is nothing but punctuation", () => {
    // The caller falls back to the region's number, so no file is named after
    // nothing.
    expect(sanitizeNamePart("...")).toBe("");
  });
});

describe("regionFileName", () => {
  it("keeps today's name exactly for a track's only region", () => {
    // Standing rule 4. Nothing that already works changes: no suffix, no
    // number, the same string this app has written since before the map.
    expect(
      regionFileName("clip-30s.mp3", "wav", { number: 1, onlyRegion: true })
    ).toBe("sliced_clip-30s.wav");
  });

  it("numbers an unnamed region when there are many", () => {
    expect(
      regionFileName("clip-30s.mp3", "wav", { number: 3, onlyRegion: false })
    ).toBe("sliced_clip-30s_3.wav");
  });

  it("uses the region's name when it has one", () => {
    expect(
      regionFileName("clip-30s.mp3", "wav", {
        name: "chorus",
        number: 2,
        onlyRegion: false,
      })
    ).toBe("sliced_clip-30s_chorus.wav");
  });

  it("falls back to the number when the name sanitises away", () => {
    expect(
      regionFileName("clip-30s.mp3", "wav", {
        name: "///",
        number: 2,
        onlyRegion: false,
      })
    ).toBe("sliced_clip-30s_2.wav");
  });

  it("keeps the stem, so you can see which source each file came from", () => {
    expect(
      regionFileName("interview.wav", "mp3", { number: 1, onlyRegion: false })
    ).toBe("sliced_interview_1.mp3");
  });

  it("takes the card's prefix", () => {
    expect(
      regionFileName(
        "clip-30s.mp3",
        "wav",
        { number: 1, onlyRegion: true },
        "trimmed_"
      )
    ).toBe("trimmed_clip-30s.wav");
  });

  it("a name holding a slash still produces one file, not a path", () => {
    const name = regionFileName("a.wav", "wav", {
      name: "verse/chorus",
      number: 1,
      onlyRegion: false,
    });

    expect(name).toBe("sliced_a_verse-chorus.wav");
    expect(name).not.toContain("/");
  });

  it("gives two regions named the same a (2), and loses neither", () => {
    // One shared `taken` set across the whole export is what makes this work.
    // `zip.file` overwrites without a word, so a lost name is a lost file.
    const taken = new Set<string>();
    const names = [1, 2].map((number) =>
      uniqueFileName(
        taken,
        regionFileName("a.wav", "wav", {
          name: "chorus",
          number,
          onlyRegion: false,
        })
      )
    );

    expect(names).toEqual(["sliced_a_chorus.wav", "sliced_a_chorus (2).wav"]);
    expect(new Set(names).size).toBe(2);
  });
});
