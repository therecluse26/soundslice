import { describe, expect, it } from "vitest";
import {
  MP3_SAMPLE_RATES,
  id3TagLength,
  mp3BitrateFor,
  nearestMp3SampleRate,
  sniffSampleRate,
} from "./audio-format";

/**
 * Headers built by hand, byte by byte.
 *
 * These are the only tests in the repo that assert on real file bytes, and they
 * carry the weight of baselines finding 3: every file used to decode at the
 * machine's rate, so the same file gave different exported bytes on two
 * machines. If this module reads a rate wrong, that break comes back and
 * nothing else notices.
 */

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0)));
}

function u32le(value: number): Uint8Array {
  return bytes(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff
  );
}

function fmtChunk(sampleRate: number, channels = 2): Uint8Array {
  return concat(
    ascii("fmt "),
    u32le(16),
    bytes(1, 0), // PCM
    bytes(channels, 0),
    u32le(sampleRate),
    u32le(sampleRate * channels * 2),
    bytes(channels * 2, 0),
    bytes(16, 0)
  );
}

function wav(sampleRate: number, ...before: Uint8Array[]): Uint8Array {
  return concat(
    ascii("RIFF"),
    u32le(1000),
    ascii("WAVE"),
    ...before,
    fmtChunk(sampleRate),
    ascii("data"),
    u32le(0)
  );
}

/**
 * A chunk of `size` bytes of zeroes, with the given id.
 *
 * Padded to an even length, as RIFF requires. The size field does not count the
 * pad byte, which is exactly the trap `sniffRiff`'s walk has to handle.
 */
function junk(id: string, size: number): Uint8Array {
  return concat(ascii(id), u32le(size), new Uint8Array(size + (size % 2)));
}

/**
 * One MPEG-1 Layer III frame header plus its payload, so the sniffer's
 * second-frame check has something to land on.
 *
 * Bitrate index 9 is 128 kbps. At 44100 Hz that frame is
 * `floor(144000 * 128 / 44100)` = 417 bytes.
 */
function mp3Frame(rateIndex: number, count = 2): Uint8Array {
  const rate = [44100, 48000, 32000][rateIndex];
  const frameBytes = Math.floor((144000 * 128) / rate);

  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const frame = new Uint8Array(frameBytes);
    frame.set(bytes(0xff, 0xfb, 0x90 | (rateIndex << 2), 0x00), 0);
    parts.push(frame);
  }
  return concat(...parts);
}

/** An ID3v2 tag of `size` bytes of payload, filled with `fill`. */
function id3(size: number, fill = 0): Uint8Array {
  const payload = new Uint8Array(size).fill(fill);
  return concat(
    ascii("ID3"),
    bytes(4, 0, 0),
    bytes(
      (size >> 21) & 0x7f,
      (size >> 14) & 0x7f,
      (size >> 7) & 0x7f,
      size & 0x7f
    ),
    payload
  );
}

describe("sniffSampleRate — WAV", () => {
  it("reads a plain 44.1 kHz file", () => {
    expect(sniffSampleRate(wav(44100))).toBe(44100);
  });

  it("reads 48 kHz", () => {
    expect(sniffSampleRate(wav(48000))).toBe(48000);
  });

  it("walks past a chunk that comes before fmt", () => {
    // A WAV from a DAW usually carries JUNK or bext first. Reading a fixed
    // offset of 24 would return four bytes of that chunk's payload.
    expect(sniffSampleRate(wav(44100, junk("JUNK", 28)))).toBe(44100);
  });

  it("walks past an odd-length chunk, which is padded to even", () => {
    // Missing the pad byte lands the walk one byte inside the next chunk id,
    // and the loop then finds nothing at all.
    expect(sniffSampleRate(wav(44100, junk("LIST", 7)))).toBe(44100);
  });

  it("reads RF64, which is WAV with a different magic", () => {
    const file = wav(44100);
    file.set(ascii("RF64"), 0);
    expect(sniffSampleRate(file)).toBe(44100);
  });

  it("refuses a rate outside what OfflineAudioContext accepts", () => {
    expect(sniffSampleRate(wav(1))).toBeNull();
  });

  it("returns null rather than throwing on a truncated file", () => {
    expect(sniffSampleRate(wav(44100).slice(0, 14))).toBeNull();
  });
});

describe("sniffSampleRate — MP3", () => {
  it("reads 44.1 kHz from the first frame header", () => {
    expect(sniffSampleRate(mp3Frame(0))).toBe(44100);
  });

  it("reads 48 kHz", () => {
    expect(sniffSampleRate(mp3Frame(1))).toBe(48000);
  });

  it("reads 32 kHz", () => {
    expect(sniffSampleRate(mp3Frame(2))).toBe(32000);
  });

  it("reads MPEG 2 rates", () => {
    // Version bits 10 is MPEG 2, whose index 0 is 22050 rather than 44100.
    const header = bytes(0xff, 0xf3, 0x90, 0x00);
    expect(sniffSampleRate(header)).toBe(22050);
  });

  it("skips a small ID3v2 tag", () => {
    expect(sniffSampleRate(concat(id3(40), mp3Frame(1)))).toBe(48000);
  });

  it("gives up rather than guessing when the tag runs past these bytes", () => {
    // This is the bug that shipped for one benchmark run. `clip-30s.mp3` has
    // 605216 bytes of ID3 for its album art, ten times the sniff window. The
    // old code fell back to scanning from offset 10 — inside the artwork — found
    // a byte pair that looked like a frame header, and reported 11025 Hz for a
    // 44.1 kHz file. The whole file then decoded at a quarter of its rate.
    //
    // 0xFF bytes stand in for the artwork: they are what a false sync is made
    // of. The answer must be null, so `AudioLoader` reads past the tag and asks
    // again.
    const truncated = concat(id3(2000, 0xff)).slice(0, 900);
    expect(sniffSampleRate(truncated)).toBeNull();
  });

  it("rejects a reserved rate index and keeps looking", () => {
    // Rate index 11 is reserved. Accepting it would index past the table and
    // return undefined, which reads as "unknown format" for a file that is fine.
    const bad = bytes(0xff, 0xfb, 0x9c, 0x00);
    expect(sniffSampleRate(concat(bad, mp3Frame(0)))).toBe(44100);
  });

  it("rejects a lone false sync with no second frame behind it", () => {
    // Eleven set bits appear in random data every couple of kilobytes. One
    // header is not evidence; two, exactly one frame apart, is.
    const noise = new Uint8Array(4096).fill(0x11);
    noise.set(bytes(0xff, 0xfb, 0x90, 0x00), 100);
    expect(sniffSampleRate(noise)).toBeNull();
  });

  it("ignores Layer II, whose bitrate table is a different one", () => {
    // Layer bits 10. Reading it with Layer III's table gives a wrong frame
    // length, so the second-frame check would land on nothing.
    expect(sniffSampleRate(bytes(0xff, 0xfd, 0x90, 0x00))).toBeNull();
  });

  it("returns null for bytes that are not audio at all", () => {
    expect(sniffSampleRate(ascii("not audio, just text"))).toBeNull();
  });
});

describe("id3TagLength", () => {
  it("is zero when there is no tag", () => {
    expect(id3TagLength(mp3Frame(0))).toBe(0);
  });

  it("counts the header and the syncsafe payload size", () => {
    expect(id3TagLength(id3(40))).toBe(50);
  });

  it("reads a size that needs all four syncsafe bytes", () => {
    // 605216 is the real tag in `bench-audio/clip-30s.mp3`. Treating the size
    // as a plain big-endian integer instead of a syncsafe one reads it as
    // 1211008, which lands past the first frame.
    expect(id3TagLength(id3(605216).slice(0, 64))).toBe(605226);
  });

  it("counts the footer when its flag is set", () => {
    const tag = id3(40);
    tag[5] = 0x10;
    expect(id3TagLength(tag)).toBe(60);
  });
});

describe("nearestMp3SampleRate and mp3BitrateFor", () => {
  it("leaves a rate MP3 already allows alone", () => {
    for (const rate of MP3_SAMPLE_RATES) {
      expect(nearestMp3SampleRate(rate)).toBe(rate);
    }
  });

  it("brings a 96 kHz source down to 48 kHz", () => {
    expect(nearestMp3SampleRate(96000)).toBe(48000);
  });

  it("snaps an odd rate to the closest legal one", () => {
    expect(nearestMp3SampleRate(22000)).toBe(22050);
  });

  it("keeps 320 kbps for every MPEG-1 rate, which is what exports use today", () => {
    expect(mp3BitrateFor(48000)).toBe(320);
    expect(mp3BitrateFor(44100)).toBe(320);
    expect(mp3BitrateFor(32000)).toBe(320);
  });

  it("drops to 160 kbps below 32 kHz, where 320 is not a legal bitrate", () => {
    // `shine.js` answers "Invalid configuration" and encodes nothing. Before
    // ticket 008 this could not fire: every buffer arrived at the machine's
    // rate. Decoding at the file's own rate opened it.
    expect(mp3BitrateFor(24000)).toBe(160);
    expect(mp3BitrateFor(11025)).toBe(160);
  });
});

describe("sniffSampleRate — FLAC and Ogg", () => {
  it("reads FLAC's twenty-bit rate out of STREAMINFO", () => {
    const file = concat(
      ascii("fLaC"),
      bytes(0x00, 0x00, 0x00, 0x22), // STREAMINFO, 34 bytes
      new Uint8Array(34)
    );
    // 44100 is 0xAC44. Twenty bits, starting at byte 18.
    file[18] = 0x0a;
    file[19] = 0xc4;
    file[20] = 0x40;
    expect(sniffSampleRate(file)).toBe(44100);
  });

  it("reads Ogg Vorbis's identification header", () => {
    const file = concat(
      ascii("OggS"),
      new Uint8Array(24),
      bytes(0x01),
      ascii("vorbis"),
      u32le(0), // version
      bytes(2), // channels
      u32le(44100)
    );
    expect(sniffSampleRate(file)).toBe(44100);
  });

  it("reports Opus as 48 kHz, which is what it always decodes to", () => {
    const file = concat(ascii("OggS"), new Uint8Array(24), ascii("OpusHead"));
    expect(sniffSampleRate(file)).toBe(48000);
  });
});
