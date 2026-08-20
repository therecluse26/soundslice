/**
 * Writing a RIFF WAVE file by hand, at 16 or 24 bits.
 *
 * No browser encodes 24-bit PCM through WebCodecs except Safari, so this stays
 * hand-written — and that is a good thing. It needs no feature detection, no
 * muxer and no WASM, and it works in every browser. Ticket 004 called it the
 * cheapest win in ticket 011.
 *
 * **Plain functions over `Float32Array`, and no `AudioBuffer` anywhere.** That is
 * the rule `dsp.ts` states and ticket 006 depends on: the moment this file
 * imports an `AudioBuffer`, its tests need a browser. Vitest runs in plain
 * `node`.
 *
 * ## Two headers, not one
 *
 * A 16-bit file uses `WAVE_FORMAT_PCM` with a 16-byte `fmt ` chunk. That is 44
 * header bytes and it is what this app has always written.
 *
 * A 24-bit file uses **`WAVE_FORMAT_EXTENSIBLE` with a 40-byte `fmt ` chunk**,
 * which is 68 header bytes. Microsoft's own reference says `wBitsPerSample`
 * "should be equal to 8 or 16" under `WAVE_FORMAT_PCM`, and the McGill WAVE
 * reference names the failure directly:
 *
 * > a file with 24-bit data declared as a standard FORMAT_PCM format code will
 * > not play, but a file with 24-bit data declared as a WAVE_FORMAT_EXTENSIBLE
 * > file with a WAVE_FORMAT_PCM subcode can be played
 *
 * Windows Media Player is the player that enforces it. Ticket 011's acceptance
 * asks every format to open in at least two other players, so the tolerated
 * shortcut is not good enough here. It costs 24 header bytes.
 */

import { BitDepth } from "./output-format";

/** What a WAV file needs to know about itself, before any sample is written. */
export type WavPlan = {
  numberOfChannels: number;
  sampleRate: number;
  /** Frames, per channel. Not bytes and not samples. */
  length: number;
  bitDepth: BitDepth;
};

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * The fixed tail of the `SubFormat` GUID, after its first two bytes.
 *
 * The first two bytes are the format tag this extensible file really is —
 * `WAVE_FORMAT_PCM` for us. Quoted from the McGill WAVE reference: "The
 * remaining 14 bytes contain a fixed string."
 */
const SUBFORMAT_GUID_TAIL = [
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b,
  0x71,
];

/**
 * Which speaker each channel feeds.
 *
 * `0x4` is `SPEAKER_FRONT_CENTER` and `0x3` is front left plus front right.
 * Anything else writes `0`, which means "map the channels in order" — the honest
 * answer when we do not know the layout.
 */
function channelMask(numberOfChannels: number): number {
  if (numberOfChannels === 1) return 0x4;
  if (numberOfChannels === 2) return 0x3;
  return 0;
}

function bytesPerSample(bitDepth: BitDepth): number {
  return bitDepth / 8;
}

export function wavBlockAlign(plan: WavPlan): number {
  return plan.numberOfChannels * bytesPerSample(plan.bitDepth);
}

export function wavDataBytes(plan: WavPlan): number {
  return plan.length * wavBlockAlign(plan);
}

/** 44 bytes at 16 bits, 68 at 24. The difference is the extensible `fmt ` chunk. */
export function wavHeaderBytes(bitDepth: BitDepth): number {
  return bitDepth === 16 ? 44 : 68;
}

/**
 * The whole file length, pad byte included.
 *
 * RIFF requires a pad byte after any chunk of odd length. A 16-bit file can
 * never need one — every frame is an even number of bytes. **A 24-bit mono file
 * of odd length can**, and the 16-bit writer never had to think about it.
 */
export function wavByteLength(plan: WavPlan): number {
  const data = wavDataBytes(plan);
  return wavHeaderBytes(plan.bitDepth) + data + (data % 2);
}

/**
 * Writes the header, and returns the byte offset the samples start at.
 *
 * The `data` chunk's own size excludes the pad byte, per RIFF; the enclosing
 * `RIFF` size includes it, because the byte is really in the file.
 */
export function writeWavHeader(view: DataView, plan: WavPlan): number {
  const extensible = plan.bitDepth !== 16;
  const blockAlign = wavBlockAlign(plan);
  const dataBytes = wavDataBytes(plan);
  const headerBytes = wavHeaderBytes(plan.bitDepth);
  const fmtBytes = extensible ? 40 : 16;

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, headerBytes - 8 + dataBytes + (dataBytes % 2), true);
  writeString(8, "WAVE");

  writeString(12, "fmt ");
  view.setUint32(16, fmtBytes, true);
  view.setUint16(20, extensible ? WAVE_FORMAT_EXTENSIBLE : WAVE_FORMAT_PCM, true);
  view.setUint16(22, plan.numberOfChannels, true);
  view.setUint32(24, plan.sampleRate, true);
  view.setUint32(28, plan.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, plan.bitDepth, true);

  if (extensible) {
    view.setUint16(36, 22, true); // cbSize
    view.setUint16(38, plan.bitDepth, true); // wValidBitsPerSample
    view.setUint32(40, channelMask(plan.numberOfChannels), true);
    view.setUint16(44, WAVE_FORMAT_PCM, true); // the GUID's own format tag
    for (let i = 0; i < SUBFORMAT_GUID_TAIL.length; i++) {
      view.setUint8(46 + i, SUBFORMAT_GUID_TAIL[i]);
    }
  }

  writeString(headerBytes - 8, "data");
  view.setUint32(headerBytes - 4, dataBytes, true);

  return headerBytes;
}

/**
 * One sample, as the integer the file stores.
 *
 * The scaling is asymmetric on purpose, and it is what this app has always
 * written: a negative sample uses the full `2^(n-1)` and a positive one uses
 * `2^(n-1) - 1`, so −1.0 and +1.0 both reach full scale.
 *
 * **`Math.round` is new.** The old writer handed a float to
 * `DataView.setInt16`, which truncates toward zero, so every sample was pulled
 * a fraction of a step towards silence. It is under half a step — below −90 dBFS
 * at 16 bits — but it biased every sample in the same direction, and the 24-bit
 * path has to round by hand anyway. One rule in one file beats two.
 */
export function quantize(sample: number, bitDepth: BitDepth): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  const positive = bitDepth === 16 ? 0x7fff : 0x7fffff;
  const negative = bitDepth === 16 ? 0x8000 : 0x800000;

  return Math.round(clamped < 0 ? clamped * negative : clamped * positive);
}

/**
 * Writes frames `[fromFrame, toFrame)` interleaved, at the offset they belong at.
 *
 * The offset is worked out from `fromFrame`, so a caller may write the file in
 * any number of chunks and in any order. The encode worker writes it in chunks
 * of `CHUNK_FRAMES` so it can yield between them and hear a `cancel`.
 */
export function writeWavFrames(
  view: DataView,
  plan: WavPlan,
  channels: Float32Array[],
  fromFrame: number,
  toFrame: number
): void {
  const blockAlign = wavBlockAlign(plan);
  const width = bytesPerSample(plan.bitDepth);
  let offset = wavHeaderBytes(plan.bitDepth) + fromFrame * blockAlign;

  for (let frame = fromFrame; frame < toFrame; frame++) {
    for (let channel = 0; channel < plan.numberOfChannels; channel++) {
      const value = quantize(channels[channel][frame], plan.bitDepth);

      if (width === 2) {
        view.setInt16(offset, value, true);
      } else {
        // Little-endian three-byte two's complement. `value >> 8` and `& 0xff`
        // read JavaScript's own 32-bit two's complement, so a negative number
        // needs no sign fixup: −1 writes `ff ff ff`.
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
      }

      offset += width;
    }
  }
}
