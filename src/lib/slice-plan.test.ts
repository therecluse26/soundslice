import { describe, expect, it } from "vitest";
import type { EditorTrack } from "@/stores/audio-store";
import { Region, defaultRegion } from "./edit-stack";
import { OutputFormat } from "./output-format";
import { planSlices } from "./slice-plan";

function at(id: string, start: number, end: number, name?: string): Region {
  return { ...defaultRegion(start, end), id, name };
}

function track(name: string, regions: Region[], extra: Partial<EditorTrack> = {}) {
  return { file: new File(["x"], name), regions, ...extra } as EditorTrack;
}

const MASTER = {
  normalizeAudio: false,
  applyPostProcessing: false,
  exportFileType: OutputFormat.WAV,
};

const TWO = track("talk.wav", [at("b", 5, 6), at("a", 0, 1)]);
const ONE = track("song.mp3", [at("c", 2, 3)]);
const NONE = track("empty.wav", []);

describe("planSlices, separate files", () => {
  it("writes one file per region, by start time", () => {
    const plan = planSlices([TWO, ONE, NONE], MASTER);

    expect(plan.map((item) => item.name)).toEqual([
      "sliced_talk_1.wav",
      "sliced_talk_2.wav",
      "sliced_song.wav",
    ]);
    expect(plan[0].parts[0].regions[0].id).toBe("a");
  });

  it("gives a track its own format when it overrides the master", () => {
    const flac = track("talk.wav", [at("a", 0, 1)], {
      exportOverrides: { exportFileType: OutputFormat.FLAC, bitDepth: 24 },
    });
    const [item] = planSlices([flac], MASTER);

    expect(item.name).toBe("sliced_talk.flac");
    expect(item.settings.exportFileType).toBe(OutputFormat.FLAC);
    expect(item.settings.bitDepth).toBe(24);
  });
});

describe("planSlices, one file per track", () => {
  it("joins in the join strip's order, with its crossfades", () => {
    const joined = track("talk.wav", [at("a", 0, 1), at("b", 5, 6)], {
      join: { order: ["b", "a"], crossfadeMs: { a: 30 } },
    });
    const [item] = planSlices([joined], { ...MASTER, joinMode: "track" });

    expect(item.name).toBe("sliced_talk.wav");
    expect(item.parts[0].regions.map((r) => r.id)).toEqual(["b", "a"]);
    expect(item.parts[0].crossfadesMs).toEqual([0, 30]);
  });
});

describe("planSlices, one file for everything", () => {
  it("writes one file, tracks in card order, in the master format", () => {
    const flac = track("song.mp3", [at("c", 2, 3)], {
      exportOverrides: { exportFileType: OutputFormat.FLAC },
    });
    const plan = planSlices([TWO, NONE, flac], { ...MASTER, joinMode: "all" });

    expect(plan).toHaveLength(1);
    expect(plan[0].name).toBe("sliced_joined.wav");
    expect(plan[0].settings.exportFileType).toBe(OutputFormat.WAV);
    expect(plan[0].parts.map((part) => part.track.file.name)).toEqual([
      "talk.wav",
      "song.mp3",
    ]);
  });

  it("writes nothing when no track has a region", () => {
    expect(planSlices([NONE], { ...MASTER, joinMode: "all" })).toEqual([]);
  });
});
