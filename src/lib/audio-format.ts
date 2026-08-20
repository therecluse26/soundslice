/**
 * Reading a file's own sample rate out of its first few kilobytes.
 *
 * This exists because of baselines finding 3: every file decoded to 48000 Hz,
 * whatever its own rate, because `decodeAudioData` resamples to the
 * `AudioContext`'s rate and that rate follows the audio hardware. **The same
 * file on two machines produced different bytes**, which breaks standing rule 1.
 *
 * [The edit stack design](../../.wayfinder/designs/edit-stack.md) section 10
 * says the export context is created at the source file's own rate. To do that,
 * something has to know the rate before the decode, and `decodeAudioData` only
 * reports it after. So we read the container header.
 *
 * Plain functions over `Uint8Array`. No Web Audio, no DOM, so Vitest reads this
 * under Node — the same rule `dsp.ts` states.
 *
 * A format this cannot read returns `null`, and the caller falls back to the
 * machine's rate. That is today's behaviour, so an unreadable file is no worse
 * off than it is now.
 */

/** How much of the file `sniffSampleRate` needs. Headers live at the front. */
export const SNIFF_BYTES = 64 * 1024;

/** MPEG audio frame header sample rates, by version then by rate index. */
const MPEG_RATES: Record<number, number[]> = {
  0: [11025, 12000, 8000], // MPEG 2.5
  2: [22050, 24000, 16000], // MPEG 2
  3: [44100, 48000, 32000], // MPEG 1
};

/** Layer III bitrates in kbps, by index. MPEG 1 has its own table. */
const MPEG1_LAYER3_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG2_LAYER3_BITRATES = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];

/**
 * Every sample rate an MP3 file may carry.
 *
 * This is not trivia. `shine.js` refuses any other rate outright — it answers
 * "Invalid configuration" and encodes nothing. Before ticket 008 that could
 * never fire, because every buffer arrived at the machine's rate and every
 * machine runs at 44.1 or 48 kHz. Decoding at the file's own rate opened it.
 */
export const MP3_SAMPLE_RATES = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
];

/** The MP3 rate closest to this one. A 96 kHz source picks 48 kHz. */
export function nearestMp3SampleRate(sampleRate: number): number {
  return nearest(MP3_SAMPLE_RATES, sampleRate);
}

/** The entry closest to `wanted`. On a tie the earlier entry wins. */
function nearest(candidates: number[], wanted: number): number {
  let best = candidates[0];
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

/**
 * The five rates Opus encodes at.
 *
 * RFC 6716: "The MDCT layer always operates internally at a sample rate of
 * 48 kHz", and the rates it accepts are 8, 12, 16, 24 or 48 kHz. Nothing else
 * exists — 44.1 kHz included.
 *
 * Both engines resample silently rather than refusing, which sounds friendly and
 * is a trap: the file then plays at a rate nobody wrote down. Chromium's
 * `audio_opus_encoder.cc` falls back to 48 kHz for any rate outside the list,
 * and Firefox's `AudioEncoder.cpp` says the same in a comment. So we pick the
 * rate ourselves, before the encoder sees the audio.
 */
export const OPUS_SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000];

/**
 * The rates the Export section offers, beside "Same as source".
 *
 * Short on purpose. WAV and FLAC take any rate at all, but a list of every legal
 * rate is a list nobody reads. These nine are the ones people ask for: telephone
 * and speech at the bottom, CD and video in the middle, high-resolution at the
 * top.
 *
 * A rate this list offers is not a rate every format accepts. MP3 and Opus each
 * snap it to their own — `AudioService.exportSampleRate` does that, and the
 * control says so.
 */
export const EXPORT_SAMPLE_RATES = [
  8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000,
];

/** The Opus rate closest to this one. A 44.1 kHz source picks 48 kHz. */
export function nearestOpusSampleRate(sampleRate: number): number {
  return nearest(OPUS_SAMPLE_RATES, sampleRate);
}

/**
 * The bitrate to encode this rate at.
 *
 * 320 kbps is an MPEG-1 bitrate, and MPEG-1 is only the three rates at 32 kHz
 * and above. Below that the file is MPEG-2 or MPEG-2.5, whose Layer III table
 * stops at 160 kbps. Asking for 320 there is the "Invalid configuration" above.
 *
 * 320 is what every export has used since before this map existed, so nothing
 * that worked before changes.
 */
export function mp3BitrateFor(sampleRate: number): number {
  return sampleRate >= 32000 ? 320 : 160;
}

/**
 * The file's own sample rate, or `null` if this container is not one we read.
 *
 * Handles WAV and RF64, MP3, FLAC, and Ogg carrying Vorbis or Opus. Returns
 * `null` for MP4, M4A and anything else.
 */
export function sniffSampleRate(bytes: Uint8Array): number | null {
  return (
    sniffRiff(bytes) ??
    sniffFlac(bytes) ??
    sniffOgg(bytes) ??
    sniffMpeg(bytes) ??
    null
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function u32le(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return -1;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * WAV and RF64. Walks the chunk list to `fmt `, whose data holds the rate four
 * bytes in.
 *
 * Walking is required, not optional. A WAV written by a DAW often carries a
 * `JUNK` or `bext` chunk before `fmt `, so a fixed offset of 24 reads the wrong
 * four bytes.
 */
function sniffRiff(bytes: Uint8Array): number | null {
  const magic = ascii(bytes, 0, 4);
  if (magic !== "RIFF" && magic !== "RF64") return null;
  if (ascii(bytes, 8, 4) !== "WAVE") return null;

  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    if (size < 0) return null;

    if (id === "fmt ") {
      const rate = u32le(bytes, offset + 12);
      return isPlausible(rate) ? rate : null;
    }

    // Chunks are padded to an even length. Missing this walks into the middle
    // of the next chunk id and the loop finds nothing.
    offset += 8 + size + (size % 2);
  }

  return null;
}

/**
 * FLAC. The STREAMINFO block is always first, and always this shape, so the
 * rate sits at a fixed offset: 4 bytes of magic, 4 of block header, 10 of block
 * sizes, then 20 bits of sample rate.
 */
function sniffFlac(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== "fLaC") return null;
  if (bytes.length < 21) return null;

  const rate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
  return isPlausible(rate) ? rate : null;
}

/**
 * Ogg carrying Vorbis or Opus.
 *
 * Opus always decodes at 48000 Hz whatever its input rate was, so `OpusHead`'s
 * own "original rate" field is not the answer and is deliberately not read.
 */
function sniffOgg(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== "OggS") return null;

  const limit = Math.min(bytes.length, 4096);

  // `i + 8 <= limit` is the bound for the shorter of the two magics,
  // `OpusHead`. Bounding on the Vorbis header's rate field instead would stop
  // the search eight bytes early and miss an Opus file at the end of the range;
  // `u32le` guards its own read.
  for (let i = 0; i + 8 <= limit; i++) {
    if (bytes[i] === 0x01 && ascii(bytes, i + 1, 6) === "vorbis") {
      const rate = u32le(bytes, i + 12);
      return isPlausible(rate) ? rate : null;
    }
    if (ascii(bytes, i, 8) === "OpusHead") return 48000;
  }

  return null;
}

/**
 * Where the audio starts, past any ID3v2 tag. Zero when there is no tag.
 *
 * The caller needs this because a tag can be **larger than the bytes it read**.
 * `clip-30s.mp3` in the benchmark set carries 605216 bytes of ID3, nearly ten
 * times the sniff window, because it embeds album art.
 */
export function id3TagLength(bytes: Uint8Array): number {
  if (ascii(bytes, 0, 3) !== "ID3" || bytes.length < 10) return 0;

  // A syncsafe integer: four bytes, seven bits each.
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);

  return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

/**
 * MP3. Skips an ID3v2 tag, then finds the first frame header.
 *
 * **A tag that runs past these bytes gives up.** It does not fall back to
 * scanning the tag itself. That fallback is how this function once reported
 * 11025 Hz for a 44.1 kHz file: album-art bytes contain `0xFF` followed by
 * three set bits often enough, and the wrong answer then decoded the whole file
 * at a quarter of its rate. A caller that wants the answer must read past the
 * tag and ask again — `AudioLoader` does.
 *
 * A candidate is confirmed by finding a **second** frame header exactly one
 * frame later. `0xFF` and three set bits is eleven bits, which random data
 * produces every 2 KB or so.
 */
function sniffMpeg(bytes: Uint8Array): number | null {
  const start = id3TagLength(bytes);
  if (start >= bytes.length) return null;

  for (let i = start; i + 3 < bytes.length; i++) {
    const frame = readMpegFrame(bytes, i);
    if (!frame) continue;

    const next = i + frame.frameBytes;
    // Beyond what we have, so there is no second frame to check against. One
    // valid header at the start of the audio is the best evidence available.
    if (next + 1 >= bytes.length) return frame.sampleRate;

    const second = readMpegFrame(bytes, next);
    if (second && second.sampleRate === frame.sampleRate) return frame.sampleRate;
  }

  return null;
}

type MpegFrame = { sampleRate: number; frameBytes: number };

/** Parses one frame header, or returns `null` if these bytes are not one. */
function readMpegFrame(bytes: Uint8Array, offset: number): MpegFrame | null {
  if (offset + 3 >= bytes.length) return null;
  if (bytes[offset] !== 0xff) return null;
  if ((bytes[offset + 1] & 0xe0) !== 0xe0) return null;

  const version = (bytes[offset + 1] >> 3) & 0x03;
  const layer = (bytes[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
  const padding = (bytes[offset + 2] >> 1) & 0x01;

  // Version 1 is reserved. Layer must be III — the bitrate tables below are
  // Layer III's, and an `.mp2` read with them gives a wrong frame length and so
  // a wrong answer. Rate index 3 and bitrate index 15 are invalid, and bitrate
  // index 0 is "free format", whose frame length is not in the header at all.
  if (version === 1 || layer !== 1 || rateIndex === 3) return null;
  if (bitrateIndex === 0 || bitrateIndex === 15) return null;

  const sampleRate = MPEG_RATES[version]?.[rateIndex];
  if (!sampleRate) return null;

  const isMpeg1 = version === 3;
  const bitrate = (isMpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[
    bitrateIndex
  ];
  if (!bitrate) return null;

  // Layer III carries 1152 samples per frame under MPEG 1 and 576 under the
  // others, which is where the 144 and the 72 come from.
  const perFrame = isMpeg1 ? 144000 : 72000;
  const frameBytes =
    Math.floor((perFrame * bitrate) / sampleRate) + padding;

  return frameBytes > 4 ? { sampleRate, frameBytes } : null;
}

/**
 * The range `OfflineAudioContext` accepts. A header that reads outside it has
 * been misparsed, and falling back to the machine's rate beats throwing.
 */
function isPlausible(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 3000 && rate <= 384000;
}
