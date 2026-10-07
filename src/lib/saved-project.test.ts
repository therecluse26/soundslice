import { describe, expect, it } from "vitest";
import { Region, defaultRegion } from "./edit-stack";
import { OutputFormat } from "./output-format";
import {
  EMPTY_SAVED_PROJECTS,
  MAX_SAVED_PROJECTS,
  parseWork,
  projectFile,
  readProjectFile,
  rememberWork,
  serializeWork,
  workSignature,
} from "./saved-project";
import type { TrackWork } from "./track-work";

function at(id: string, start: number, end: number): Region {
  return { ...defaultRegion(start, end), id };
}

const PROFILE = {
  id: "noise-1",
  magnitudes: Float32Array.from({ length: 1025 }, (_, k) => k / 1000),
  fftSize: 2048,
  sampleRate: 44100,
};

const WORK: TrackWork = {
  regions: [at("a", 1, 2), { ...at("b", 3, 4), stretch: { rate: 1.5, semitones: 2 } }],
  selectedRegionId: "b",
  stack: [
    { op: "noiseReduction", amount: 0.4, profile: PROFILE },
    { op: "gain", db: -3 },
  ],
  exportOverrides: { exportFileType: OutputFormat.FLAC, outputSampleRate: null },
  join: { order: ["b", "a"], crossfadeMs: { a: 30 } },
};

describe("a round trip", () => {
  it("brings every part of the work back", () => {
    const back = parseWork(serializeWork(WORK));
    expect(back).not.toBeNull();
    if (!back) return;

    expect(back.regions.map((r) => [r.start, r.end, r.stretch])).toEqual([
      [1, 2, undefined],
      [3, 4, { rate: 1.5, semitones: 2 }],
    ]);
    expect(back.stack?.[1]).toEqual({ op: "gain", db: -3 });
    expect(back.exportOverrides).toEqual(WORK.exportOverrides);
  });

  it("keeps a noise profile exact, sample for sample", () => {
    const back = parseWork(serializeWork(WORK));
    const noise = back?.stack?.[0];
    expect(noise?.op).toBe("noiseReduction");
    if (noise?.op !== "noiseReduction") return;
    expect([...noise.profile.magnitudes]).toEqual([...PROFILE.magnitudes]);
  });

  it("mints new region ids, and moves every reference with them", () => {
    const back = parseWork(serializeWork(WORK));
    if (!back) throw new Error("did not parse");

    const [a, b] = back.regions;
    expect(a.id).not.toBe("a");
    expect(back.selectedRegionId).toBe(b.id);
    expect(back.join?.order).toEqual([b.id, a.id]);
    expect(back.join?.crossfadeMs).toEqual({ [a.id]: 30 });
  });
});

describe("what is refused", () => {
  it("refuses a record with an operation this build does not know", () => {
    const raw = serializeWork(WORK) as { stack: unknown[] };
    raw.stack.push({ op: "reverb", wet: 0.3 });
    expect(parseWork(raw)).toBeNull();
  });

  it("refuses a region whose numbers are not numbers", () => {
    const raw = serializeWork(WORK) as { regions: Array<Record<string, unknown>> };
    raw.regions[0].start = "soon";
    expect(parseWork(raw)).toBeNull();
  });

  it("refuses a project file of another format or version", () => {
    const text = projectFile([{ file: { name: "a.wav", size: 10 }, ...WORK }]);
    expect(readProjectFile(text)).toHaveLength(1);
    expect(readProjectFile(text.replace('"version": 1', '"version": 2'))).toBeNull();
    expect(readProjectFile("{}")).toBeNull();
    expect(readProjectFile("not json")).toBeNull();
  });
});

describe("rememberWork", () => {
  it("keeps the newest files and drops the oldest past the limit", () => {
    let saved = EMPTY_SAVED_PROJECTS;
    for (let index = 0; index < MAX_SAVED_PROJECTS + 5; index++) {
      saved = rememberWork(saved, `f${index}`, { regions: [at("a", 0, 1)] }, index);
    }

    const keys = Object.keys(saved.entries);
    expect(keys).toHaveLength(MAX_SAVED_PROJECTS);
    expect(keys).not.toContain("f0");
    expect(keys).toContain(`f${MAX_SAVED_PROJECTS + 4}`);
  });

  it("forgets a file whose work is blank", () => {
    const saved = rememberWork(EMPTY_SAVED_PROJECTS, "f", WORK, 1);
    expect(rememberWork(saved, "f", { regions: [] }, 2).entries.f).toBeUndefined();
  });
});

describe("workSignature", () => {
  it("ignores the selection, which is not work", () => {
    expect(workSignature({ ...WORK, selectedRegionId: "a" })).toBe(
      workSignature({ ...WORK, selectedRegionId: "b" })
    );
  });
});
