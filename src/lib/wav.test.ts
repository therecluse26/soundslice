import { describe, expect, it } from "vitest";
import {
  WavPlan,
  quantize,
  wavBlockAlign,
  wavByteLength,
  wavDataBytes,
  wavHeaderBytes,
  writeWavFrames,
  writeWavHeader,
} from "./wav";
import { BitDepth } from "./output-format";

function plan(overrides: Partial<WavPlan> = {}): WavPlan {
  return {
    numberOfChannels: 2,
    sampleRate: 44100,
    length: 4,
    bitDepth: 16,
    ...overrides,
  };
}

/** Writes a whole file and hands back a reader over it. */
function write(p: WavPlan, channels: Float32Array[]): DataView {
  const view = new DataView(new ArrayBuffer(wavByteLength(p)));
  writeWavHeader(view, p);
  writeWavFrames(view, p, channels, 0, p.length);
  return view;
}

function ascii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

/** The three-byte little-endian sample at this offset, sign extended. */
function int24(view: DataView, offset: number): number {
  const raw =
    view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16);

  return raw & 0x800000 ? raw - 0x1000000 : raw;
}

describe("quantize", () => {
  it("puts full scale at both ends, at 16 bits", () => {
    expect(quantize(1, 16)).toBe(32767);
    expect(quantize(-1, 16)).toBe(-32768);
  });

  it("puts full scale at both ends, at 24 bits", () => {
    expect(quantize(1, 24)).toBe(8388607);
    expect(quantize(-1, 24)).toBe(-8388608);
  });

  it("clamps anything past full scale", () => {
    expect(quantize(4, 16)).toBe(32767);
    expect(quantize(-4, 24)).toBe(-8388608);
  });

  it("rounds rather than truncating toward zero", () => {
    // 0.9999999 * 32767 is 32766.996…, which truncation would report as 32766.
    expect(quantize(0.9999999, 16)).toBe(32767);
    // A sample one third of a step above zero rounds back to zero, not down.
    expect(quantize(0.4 / 32767, 16)).toBe(0);
    expect(quantize(0.6 / 32767, 16)).toBe(1);
  });

  it("keeps silence silent", () => {
    expect(quantize(0, 16)).toBe(0);
    expect(quantize(0, 24)).toBe(0);
  });
});

describe("wav sizes", () => {
  it("uses a 44-byte header at 16 bits and 68 at 24", () => {
    expect(wavHeaderBytes(16)).toBe(44);
    expect(wavHeaderBytes(24)).toBe(68);
  });

  it("counts three bytes per sample at 24 bits", () => {
    expect(wavBlockAlign(plan({ bitDepth: 24 }))).toBe(6);
    expect(wavDataBytes(plan({ bitDepth: 24, length: 10 }))).toBe(60);
  });

  it("adds a pad byte only when the data length is odd", () => {
    // 24-bit mono: 3 bytes a frame, so an odd frame count is an odd byte count.
    const odd = plan({ bitDepth: 24, numberOfChannels: 1, length: 5 });
    expect(wavDataBytes(odd)).toBe(15);
    expect(wavByteLength(odd)).toBe(68 + 15 + 1);

    const even = plan({ bitDepth: 24, numberOfChannels: 1, length: 4 });
    expect(wavByteLength(even)).toBe(68 + 12);
  });

  it("never needs a pad byte at 16 bits", () => {
    for (let length = 0; length < 8; length++) {
      for (const channels of [1, 2]) {
        const p = plan({ numberOfChannels: channels, length });
        expect(wavByteLength(p)).toBe(44 + wavDataBytes(p));
      }
    }
  });
});

describe("the 16-bit header", () => {
  const p = plan();
  const view = write(p, [new Float32Array(4), new Float32Array(4)]);

  it("is RIFF/WAVE with a fmt and a data chunk", () => {
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(ascii(view, 36, 4)).toBe("data");
  });

  it("declares plain PCM in a 16-byte fmt chunk", () => {
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
  });

  it("carries the rate, the channels and the block align", () => {
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("sizes RIFF as the file minus eight", () => {
    expect(view.getUint32(4, true)).toBe(36 + 16);
    expect(view.getUint32(40, true)).toBe(16);
  });
});

describe("the 24-bit header", () => {
  const p = plan({ bitDepth: 24 });
  const view = write(p, [new Float32Array(4), new Float32Array(4)]);

  it("declares WAVE_FORMAT_EXTENSIBLE, not tag 1", () => {
    // Windows Media Player will not play 24-bit data declared as plain PCM.
    expect(view.getUint16(20, true)).toBe(0xfffe);
  });

  it("uses a 40-byte fmt chunk with cbSize 22", () => {
    expect(view.getUint32(16, true)).toBe(40);
    expect(view.getUint16(36, true)).toBe(22);
  });

  it("says all 24 bits are valid, and maps stereo to front left and right", () => {
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint16(38, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(0x3);
  });

  it("maps a mono file to front centre", () => {
    const mono = write(plan({ bitDepth: 24, numberOfChannels: 1 }), [
      new Float32Array(4),
    ]);
    expect(mono.getUint32(40, true)).toBe(0x4);
  });

  it("carries the PCM subformat GUID", () => {
    expect(view.getUint16(44, true)).toBe(1);

    const tail = [
      0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38,
      0x9b, 0x71,
    ];
    for (let i = 0; i < tail.length; i++) {
      expect(view.getUint8(46 + i)).toBe(tail[i]);
    }
  });

  it("puts the data chunk after the longer fmt chunk", () => {
    expect(ascii(view, 60, 4)).toBe("data");
    expect(view.getUint32(64, true)).toBe(24);
    expect(view.getUint32(4, true)).toBe(60 + 24);
  });
});

describe("writing samples", () => {
  it("interleaves the channels, frame by frame", () => {
    const left = Float32Array.from([1, 0, -1, 0]);
    const right = Float32Array.from([0, 1, 0, -1]);
    const view = write(plan(), [left, right]);

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });

  it("writes 24-bit samples little-endian and two's complement", () => {
    const p = plan({ bitDepth: 24, numberOfChannels: 1, length: 3 });
    const view = write(p, [Float32Array.from([1, -1, 0])]);

    expect(int24(view, 68)).toBe(8388607);
    expect(int24(view, 71)).toBe(-8388608);
    expect(int24(view, 74)).toBe(0);

    // −1 full scale is 0x800000, which is `00 00 80` in that order.
    expect(view.getUint8(71)).toBe(0x00);
    expect(view.getUint8(72)).toBe(0x00);
    expect(view.getUint8(73)).toBe(0x80);
  });

  it("gives the same file whether it is written in one chunk or many", () => {
    const p = plan({ bitDepth: 24, length: 9 });
    const channels = [
      Float32Array.from([0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8, 0.9]),
      Float32Array.from([0.9, -0.8, 0.7, -0.6, 0.5, -0.4, 0.3, -0.2, 0.1]),
    ];

    const whole = write(p, channels);

    const chunked = new DataView(new ArrayBuffer(wavByteLength(p)));
    writeWavHeader(chunked, p);
    writeWavFrames(chunked, p, channels, 0, 4);
    writeWavFrames(chunked, p, channels, 4, 7);
    writeWavFrames(chunked, p, channels, 7, 9);

    expect(new Uint8Array(chunked.buffer)).toEqual(
      new Uint8Array(whole.buffer)
    );
  });

  it("leaves the pad byte at zero", () => {
    const p = plan({ bitDepth: 24, numberOfChannels: 1, length: 5 });
    const view = write(p, [Float32Array.from([1, 1, 1, 1, 1])]);

    expect(view.byteLength).toBe(84);
    expect(view.getUint8(83)).toBe(0);
  });
});

describe("every depth and channel count round-trips", () => {
  const depths: BitDepth[] = [16, 24];

  for (const bitDepth of depths) {
    for (const numberOfChannels of [1, 2]) {
      it(`${bitDepth}-bit, ${numberOfChannels} channel`, () => {
        const p = plan({ bitDepth, numberOfChannels, length: 6 });
        const channels = Array.from(
          { length: numberOfChannels },
          (_, channel) =>
            Float32Array.from([0, 0.25, -0.25, 0.5, -0.5, channel ? 1 : -1])
        );

        const view = write(p, channels);
        const dataStart = wavHeaderBytes(bitDepth);
        const width = bitDepth / 8;

        for (let frame = 0; frame < p.length; frame++) {
          for (let channel = 0; channel < numberOfChannels; channel++) {
            const offset =
              dataStart + (frame * numberOfChannels + channel) * width;
            const stored =
              width === 2 ? view.getInt16(offset, true) : int24(view, offset);

            expect(stored).toBe(quantize(channels[channel][frame], bitDepth));
          }
        }
      });
    }
  }
});
