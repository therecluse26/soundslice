import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MASTER_DEFAULTS,
  MASTER_DEFAULTS_STORAGE_KEY,
  MASTER_DEFAULTS_STORAGE_VERSION,
  MasterDefaults,
  isMasterDefaults,
} from "./master-defaults";
import { readPersisted, writePersisted } from "./persisted";
import { OutputFormat } from "./output-format";

/**
 * The first test for what survives a reload.
 *
 * `isMasterDefaults` is strict and there is no migration by policy, so **the
 * guard is the only thing standing between a new field and every user silently
 * losing their settings**. Nothing tested it until a fifth field was added.
 *
 * A tiny `localStorage`, because these tests run under plain Node. It is four
 * lines, and the alternative is a DOM environment for the whole suite — which
 * `dsp.ts`'s rule exists to avoid.
 */
const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

beforeEach(() => store.clear());

/** A complete, current-version value. Every test starts from this. */
function complete(): MasterDefaults {
  return {
    normalizeAudio: true,
    applyPostProcessing: true,
    loudnessTargetLufs: -16,
    exportFileType: OutputFormat.FLAC,
    bitDepth: 24,
    outputSampleRate: 48000,
    joinRegions: true,
  };
}

describe("isMasterDefaults", () => {
  it("accepts a complete value", () => {
    expect(isMasterDefaults(complete())).toBe(true);
  });

  it("accepts the defaults, which must pass their own guard", () => {
    expect(isMasterDefaults(DEFAULT_MASTER_DEFAULTS)).toBe(true);
  });

  it("rejects a value written before joinRegions existed", () => {
    // The version bump is what makes this reset deliberate rather than a
    // surprise. Without the bump the guard would still reject it — the user
    // would lose their settings anyway, and nothing would say why.
    const { joinRegions, ...v4 } = complete();
    void joinRegions;

    expect(isMasterDefaults(v4)).toBe(false);
  });

  it("rejects a missing or wrongly typed value, one field at a time", () => {
    for (const key of Object.keys(complete()) as (keyof MasterDefaults)[]) {
      const missing = { ...complete() };
      delete missing[key];
      expect(isMasterDefaults(missing), `missing ${key}`).toBe(false);

      expect(
        isMasterDefaults({ ...complete(), [key]: Symbol("wrong") }),
        `wrong type for ${key}`
      ).toBe(false);
    }
  });

  it("rejects a loudness target outside the range Advanced view offers", () => {
    expect(isMasterDefaults({ ...complete(), loudnessTargetLufs: -99 })).toBe(false);
    expect(isMasterDefaults({ ...complete(), loudnessTargetLufs: NaN })).toBe(false);
  });

  it("rejects a sample rate no encoder offers, and allows null", () => {
    expect(isMasterDefaults({ ...complete(), outputSampleRate: 12345 })).toBe(false);
    expect(isMasterDefaults({ ...complete(), outputSampleRate: null })).toBe(true);
  });

  it("rejects anything that is not an object", () => {
    for (const value of [null, undefined, 4, "yes", true, []]) {
      expect(isMasterDefaults(value)).toBe(false);
    }
  });
});

describe("the round trip through localStorage", () => {
  it("brings back every key it was given", () => {
    // **The structural test.** A key forgotten where the store assembles this
    // object would write a blob the guard rejects, and every setting would
    // reset on the next load with nothing pointing back at the line. Compare
    // the keys, not just the values, so a new field cannot be added to the type
    // and left out of the write.
    const written = complete();

    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      written
    );

    const read = readPersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      isMasterDefaults
    );

    expect(read).not.toBeNull();
    expect(Object.keys(read!).sort()).toEqual(
      Object.keys(DEFAULT_MASTER_DEFAULTS).sort()
    );
    expect(read).toEqual(written);
  });

  it("discards a value stored at an older version", () => {
    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION - 1,
      complete()
    );

    expect(
      readPersisted(
        MASTER_DEFAULTS_STORAGE_KEY,
        MASTER_DEFAULTS_STORAGE_VERSION,
        isMasterDefaults
      )
    ).toBeNull();
  });

  it("discards a value that fails the guard, rather than trusting the version", () => {
    const { joinRegions, ...v4 } = complete();
    void joinRegions;

    writePersisted(
      MASTER_DEFAULTS_STORAGE_KEY,
      MASTER_DEFAULTS_STORAGE_VERSION,
      v4
    );

    expect(
      readPersisted(
        MASTER_DEFAULTS_STORAGE_KEY,
        MASTER_DEFAULTS_STORAGE_VERSION,
        isMasterDefaults
      )
    ).toBeNull();
  });

  it("returns null for a key nobody has written", () => {
    expect(
      readPersisted(
        MASTER_DEFAULTS_STORAGE_KEY,
        MASTER_DEFAULTS_STORAGE_VERSION,
        isMasterDefaults
      )
    ).toBeNull();
  });

  it("survives text a person edited by hand", () => {
    localStorage.setItem("soundslice:" + MASTER_DEFAULTS_STORAGE_KEY, "{not json");

    expect(() =>
      readPersisted(
        MASTER_DEFAULTS_STORAGE_KEY,
        MASTER_DEFAULTS_STORAGE_VERSION,
        isMasterDefaults
      )
    ).not.toThrow();
  });

  it("namespaces its key, because GitHub Pages shares one origin", () => {
    writePersisted(MASTER_DEFAULTS_STORAGE_KEY, 5, complete());

    expect([...store.keys()]).toEqual([
      `soundslice:${MASTER_DEFAULTS_STORAGE_KEY}`,
    ]);
  });
});

describe("DEFAULT_MASTER_DEFAULTS", () => {
  it("joins nothing, so today's behaviour is what a new user gets", () => {
    expect(DEFAULT_MASTER_DEFAULTS.joinRegions).toBe(false);
  });

  it("is what Simple view has always exported", () => {
    expect(DEFAULT_MASTER_DEFAULTS).toEqual({
      normalizeAudio: false,
      applyPostProcessing: false,
      loudnessTargetLufs: -14,
      exportFileType: OutputFormat.WAV,
      bitDepth: 16,
      outputSampleRate: null,
      joinRegions: false,
    });
  });
});
