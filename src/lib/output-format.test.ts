import { describe, expect, it } from "vitest";
import {
  ADVANCED_FORMATS,
  FORMAT_EXTENSION,
  FORMAT_MIME,
  OutputFormat,
  SIMPLE_FORMATS,
  exportSampleRate,
  hasBitDepth,
  isLossless,
  needsWebCodecs,
} from "./output-format";
import { isAdvancedExportChoice } from "./advanced-settings";

const EVERY_FORMAT = [
  OutputFormat.WAV,
  OutputFormat.MP3,
  OutputFormat.FLAC,
  OutputFormat.OPUS,
];

describe("the format table", () => {
  it("gives every format an extension and a MIME type", () => {
    for (const format of EVERY_FORMAT) {
      expect(FORMAT_EXTENSION[format]).toBeTruthy();
      expect(FORMAT_MIME[format]).toMatch(/^audio\//);
    }
  });

  it("writes Opus into a .webm file", () => {
    // A `.opus` file is Opus in Ogg, and no engine emits the header Ogg needs.
    expect(FORMAT_EXTENSION[OutputFormat.OPUS]).toBe("webm");
    expect(FORMAT_MIME[OutputFormat.OPUS]).toBe("audio/webm");
  });

  it("keeps Simple view at WAV and MP3", () => {
    expect(SIMPLE_FORMATS).toEqual([OutputFormat.WAV, OutputFormat.MP3]);
    expect(ADVANCED_FORMATS).toHaveLength(4);
  });

  it("offers a bit depth only where samples are stored as integers", () => {
    expect(hasBitDepth(OutputFormat.WAV)).toBe(true);
    expect(hasBitDepth(OutputFormat.FLAC)).toBe(true);
    expect(hasBitDepth(OutputFormat.MP3)).toBe(false);
    expect(hasBitDepth(OutputFormat.OPUS)).toBe(false);
  });

  it("asks the browser only for Opus", () => {
    for (const format of EVERY_FORMAT) {
      expect(needsWebCodecs(format)).toBe(format === OutputFormat.OPUS);
    }
  });

  it("calls WAV and FLAC lossless, and nothing else", () => {
    expect(isLossless(OutputFormat.WAV)).toBe(true);
    expect(isLossless(OutputFormat.FLAC)).toBe(true);
    expect(isLossless(OutputFormat.MP3)).toBe(false);
    expect(isLossless(OutputFormat.OPUS)).toBe(false);
  });
});

describe("exportSampleRate", () => {
  it("keeps the file's own rate when nothing is asked for", () => {
    expect(exportSampleRate(44100, OutputFormat.WAV)).toBe(44100);
    expect(exportSampleRate(96000, OutputFormat.FLAC)).toBe(96000);
    // The whole point of baselines finding 3: the machine's rate never wins.
    expect(exportSampleRate(22050, OutputFormat.WAV)).toBe(22050);
  });

  it("gives WAV and FLAC exactly the rate asked for", () => {
    expect(exportSampleRate(44100, OutputFormat.WAV, 8000)).toBe(8000);
    expect(exportSampleRate(44100, OutputFormat.FLAC, 96000)).toBe(96000);
  });

  it("snaps MP3 to a rate shine.js accepts", () => {
    // 96 kHz is not on the MPEG list at all; asking for it is "Invalid
    // configuration" and no file.
    expect(exportSampleRate(96000, OutputFormat.MP3)).toBe(48000);
    expect(exportSampleRate(44100, OutputFormat.MP3)).toBe(44100);
    expect(exportSampleRate(44100, OutputFormat.MP3, 96000)).toBe(48000);
  });

  it("snaps Opus to one of its five rates", () => {
    // Opus has no 44.1 kHz. Both engines resample to 48 kHz silently, so we
    // pick 48 kHz ourselves and the file's real rate is the one we wrote down.
    expect(exportSampleRate(44100, OutputFormat.OPUS)).toBe(48000);
    expect(exportSampleRate(22050, OutputFormat.OPUS)).toBe(24000);
    expect(exportSampleRate(48000, OutputFormat.OPUS, 16000)).toBe(16000);
  });
});

describe("isAdvancedExportChoice", () => {
  const simple = {
    exportFileType: OutputFormat.WAV,
    bitDepth: 16,
    outputSampleRate: null,
    joinRegions: false,
  };

  it("says no to what Simple view can already describe", () => {
    expect(isAdvancedExportChoice(simple)).toBe(false);
    expect(
      isAdvancedExportChoice({ ...simple, exportFileType: OutputFormat.MP3 })
    ).toBe(false);
  });

  it("says yes to a format Simple view does not offer", () => {
    expect(
      isAdvancedExportChoice({ ...simple, exportFileType: OutputFormat.FLAC })
    ).toBe(true);
    expect(
      isAdvancedExportChoice({ ...simple, exportFileType: OutputFormat.OPUS })
    ).toBe(true);
  });

  it("says yes to 24 bits, and to a rate that is not the source's", () => {
    expect(isAdvancedExportChoice({ ...simple, bitDepth: 24 })).toBe(true);
    expect(isAdvancedExportChoice({ ...simple, outputSampleRate: 48000 })).toBe(
      true
    );
  });

  it("says yes to joined output, which Simple view has no control for", () => {
    expect(isAdvancedExportChoice({ ...simple, joinRegions: true })).toBe(true);
  });

  it("still counts as one sentence when several are true at once", () => {
    // The chip reads "1 Advanced setting active" for all of these together, not
    // four. This function returns the boolean that single `+= 1` reads.
    expect(
      isAdvancedExportChoice({
        exportFileType: OutputFormat.FLAC,
        bitDepth: 24,
        outputSampleRate: 96000,
        joinRegions: true,
      })
    ).toBe(true);
  });
});
