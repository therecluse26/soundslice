/**
 * The output format, on its own, so the encode worker can import it.
 *
 * It used to live in `audio-service.ts`. That module pulls in JSZip, and a
 * worker importing it would bundle a zip library it never calls. The worker also
 * used to declare its own copy of this enum, which is the other way to get the
 * same bug — two enums that must agree and no compiler check that they do.
 *
 * ## Four formats, three encoders
 *
 * [Ticket 004](../../.wayfinder/tickets/004-research-webcodecs-audioencoder.md)
 * measured what each browser can encode. The answer needs three paths, not two:
 *
 * | Format | Encoder | Container |
 * |---|---|---|
 * | WAV | written by hand, [`wav.ts`](./wav.ts) | RIFF, written by hand |
 * | MP3 | `@toots/shine.js`, pure JS | none, the frames are self-framing |
 * | FLAC | `@mediabunny/flac-encoder`, libFLAC in WASM | mediabunny |
 * | Opus | the browser's own `AudioEncoder` | mediabunny, **WebM** |
 *
 * **Opus writes a `.webm` file, not a `.opus` file.** WebCodecs hands back bare
 * Opus packets that carry no length, so they need a container, and no browser
 * implements the Ogg option that `.opus` requires. Ogg is therefore impossible
 * today and WebM is not, so the extension says `webm` and the label says so too.
 */

import { nearestMp3SampleRate, nearestOpusSampleRate } from "./audio-format";

/**
 * What the user picks under **Output Format**.
 *
 * The value of each member is what `localStorage` holds and what the select
 * writes, so renaming one discards a stored master default. `master-defaults.ts`
 * guards against that.
 */
export enum OutputFormat {
  MP3 = "mp3",
  WAV = "wav",
  FLAC = "flac",
  OPUS = "opus",
}

/**
 * Bits per sample, for the two formats that store samples as integers.
 *
 * MP3 and Opus are lossy and have no bit depth at all — they store frequency
 * coefficients, not samples. `hasBitDepth` is the check.
 */
export type BitDepth = 16 | 24;

export const BIT_DEPTHS: BitDepth[] = [16, 24];

/** What every export used before ticket 011, and still the default. */
export const DEFAULT_BIT_DEPTH: BitDepth = 16;

/** The extension each format writes. **Opus writes `webm`** — see above. */
export const FORMAT_EXTENSION: Record<OutputFormat, string> = {
  [OutputFormat.WAV]: "wav",
  [OutputFormat.MP3]: "mp3",
  [OutputFormat.FLAC]: "flac",
  [OutputFormat.OPUS]: "webm",
};

export const FORMAT_MIME: Record<OutputFormat, string> = {
  [OutputFormat.WAV]: "audio/wav",
  [OutputFormat.MP3]: "audio/mp3",
  [OutputFormat.FLAC]: "audio/flac",
  [OutputFormat.OPUS]: "audio/webm",
};

/** What the select shows. The extension is on the row that surprises. */
export const FORMAT_LABEL: Record<OutputFormat, string> = {
  [OutputFormat.WAV]: "WAV",
  [OutputFormat.MP3]: "MP3",
  [OutputFormat.FLAC]: "FLAC",
  [OutputFormat.OPUS]: "Opus (.webm)",
};

/**
 * Simple view offers these two, and no more.
 *
 * Ticket 011's rule 4, in one line: **Simple gains speed, not options.** A user
 * who wants FLAC has asked a question Simple view does not ask.
 */
export const SIMPLE_FORMATS: OutputFormat[] = [
  OutputFormat.WAV,
  OutputFormat.MP3,
];

export const ADVANCED_FORMATS: OutputFormat[] = [
  OutputFormat.WAV,
  OutputFormat.MP3,
  OutputFormat.FLAC,
  OutputFormat.OPUS,
];

/** True for the formats that store integer samples, so a depth means something. */
export function hasBitDepth(format: OutputFormat): boolean {
  return format === OutputFormat.WAV || format === OutputFormat.FLAC;
}

/**
 * True for the formats the browser itself encodes.
 *
 * Only Opus. Ticket 004 read three engines' source: Chromium encodes Opus and
 * AAC, Firefox Opus and Vorbis, WebKit returns the literal string "FLAC encoding
 * is not supported". Opus is the one they share, so it is the one we offer.
 *
 * A format that is `true` here **may still be unavailable** — the check is
 * `canEncodeOpus` in [`encode-capabilities.ts`](./encode-capabilities.ts).
 */
export function needsWebCodecs(format: OutputFormat): boolean {
  return format === OutputFormat.OPUS;
}

/** True when this format is lossless, so its output is the render, sample for sample. */
export function isLossless(format: OutputFormat): boolean {
  return format === OutputFormat.WAV || format === OutputFormat.FLAC;
}

/**
 * The rate an export really uses, given the file's rate and what the user asked.
 *
 * **One rate for the whole export, chosen before the decode.** Every stage after
 * it uses the buffer's own rate, so this is the only place a rate is decided and
 * no stage resamples behind another's back.
 *
 * Three things it weighs, in order:
 *
 * 1. **What the user asked for.** `wanted` when they set one, otherwise the
 *    file's own rate. That default is the edit stack design's section 10 and the
 *    fix for baselines finding 3 — the same file gave different bytes on two
 *    machines, because every decode followed the audio hardware.
 * 2. **What the encoder accepts.** `shine.js` takes nine rates and answers
 *    "Invalid configuration" for anything else. Opus takes five, and both
 *    Chromium and Firefox resample silently to 48 kHz rather than refusing —
 *    friendly, and a good way to write a file whose real rate nobody knows.
 * 3. **Nothing else.** WAV and FLAC take any rate.
 *
 * Kept here rather than on `AudioService` so Vitest can read it: that module
 * imports the encode worker, and a worker needs a browser.
 */
export function exportSampleRate(
  sourceRate: number,
  format: OutputFormat,
  wanted?: number
): number {
  const asked = wanted ?? sourceRate;

  if (format === OutputFormat.MP3) return nearestMp3SampleRate(asked);
  if (format === OutputFormat.OPUS) return nearestOpusSampleRate(asked);

  return asked;
}
