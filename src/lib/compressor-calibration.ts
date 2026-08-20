/**
 * Cancelling the makeup gain a `DynamicsCompressorNode` applies on its own.
 *
 * ## The measurement
 *
 * A 1 kHz sine through a compressor set to threshold −0.95 dB, ratio 20, knee 0
 * — the limiter this app has always used — rendered in Chromium 146:
 *
 * | Input | Output | Gain |
 * |---|---|---|
 * | −60.0 dBFS | −59.459 | **+0.541 dB** |
 * | −40.0 dBFS | −39.459 | **+0.541 dB** |
 * | −20.0 dBFS | −19.459 | **+0.541 dB** |
 * | −10.0 dBFS | −9.459 | **+0.541 dB** |
 * | −3.0 dBFS | −2.459 | **+0.541 dB** |
 * | −0.5 dBFS | −0.342 | +0.158 dB — above the threshold, so compressing |
 *
 * Identical at every level below the threshold. It is a **constant makeup
 * gain**, not compression, and nothing asked for it.
 *
 * ## Why it has to go
 *
 * Three reasons, in order of weight:
 *
 * 1. **It is not in the specification.** The Web Audio spec says nothing about a
 *    makeup gain for `DynamicsCompressorNode`. Another browser may use a
 *    different one or none, so leaving it in makes the same settings produce
 *    different audio on different browsers. Standing rule 1 exists to stop
 *    exactly that.
 * 2. **It breaks the true-peak ceiling.** The loudness operation caps its gain
 *    so the true peak lands at −1 dBTP, and then the limiter behind it adds
 *    0.541 dB. Measured end to end through the UI and confirmed with ffmpeg:
 *    −0.5 dBFS true peak where −1 was asked for.
 * 3. **It misses the loudness target by the same amount.** Exporting at a −23
 *    LUFS target produced −22.5 LUFS. EBU R128's quality-control tolerance is
 *    ±0.2 LU.
 *
 * ## Why it is measured rather than written down
 *
 * 0.541 dB is Chromium's number for one pair of settings. It is not in any
 * specification, so it cannot be hard-coded without making this app
 * Chromium-only in a way nothing would ever notice. One short offline render
 * per set of settings, cached for the life of the page, costs nothing and is
 * right everywhere.
 */

export type CompressorSettings = {
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
  attackMs: number;
  releaseMs: number;
};

/** Long enough for a 3 ms attack and a 50 ms release to settle, several times over. */
const CALIBRATION_SECONDS = 0.5;
const CALIBRATION_RATE = 44100;
const CALIBRATION_HZ = 1000;

/**
 * How far below the threshold to place the calibration tone.
 *
 * Far enough that no compression happens, so what comes back is the makeup gain
 * alone. Twenty decibels is beyond any knee this app sets.
 */
const HEADROOM_DB = 20;

const cache = new Map<string, number>();
const pending = new Map<string, Promise<number>>();

function keyOf(settings: CompressorSettings): string {
  return [
    settings.thresholdDb,
    settings.ratio,
    settings.kneeDb,
    settings.attackMs,
    settings.releaseMs,
  ].join("/");
}

/**
 * The makeup gain these settings apply, as a linear multiplier.
 *
 * **Synchronous, and returns 1 for settings nobody has calibrated.** A graph is
 * built synchronously, so the calibration has to have happened already —
 * `calibrateAll` is what makes that true. Returning 1 rather than throwing means
 * a caller that forgets gets today's behaviour, not a failed export.
 */
export function makeupGain(settings: CompressorSettings): number {
  return cache.get(keyOf(settings)) ?? 1;
}

/** Calibrates every distinct set of settings in one go, then resolves. */
export async function calibrateAll(
  settingsList: CompressorSettings[]
): Promise<void> {
  await Promise.all(settingsList.map(calibrate));
}

async function calibrate(settings: CompressorSettings): Promise<number> {
  const key = keyOf(settings);

  const known = cache.get(key);
  if (known !== undefined) return known;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const run = measureMakeup(settings)
    .then((gain) => {
      cache.set(key, gain);
      pending.delete(key);
      return gain;
    })
    .catch(() => {
      // A failed calibration must not fail an export. Unity is what this app
      // did before anyone measured, so it is the safe answer.
      cache.set(key, 1);
      pending.delete(key);
      return 1;
    });

  pending.set(key, run);
  return run;
}

async function measureMakeup(settings: CompressorSettings): Promise<number> {
  const length = Math.round(CALIBRATION_SECONDS * CALIBRATION_RATE);
  const context = new OfflineAudioContext(1, length, CALIBRATION_RATE);

  const amplitude = Math.pow(
    10,
    Math.max(-80, settings.thresholdDb - HEADROOM_DB) / 20
  );

  const buffer = context.createBuffer(1, length, CALIBRATION_RATE);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    samples[i] =
      amplitude *
      Math.sin((2 * Math.PI * CALIBRATION_HZ * i) / CALIBRATION_RATE);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = settings.thresholdDb;
  compressor.ratio.value = settings.ratio;
  compressor.knee.value = settings.kneeDb;
  compressor.attack.value = settings.attackMs / 1000;
  compressor.release.value = settings.releaseMs / 1000;

  source.connect(compressor);
  compressor.connect(context.destination);
  source.start(0);

  const rendered = await context.startRendering();
  const out = rendered.getChannelData(0);

  // Read the back half only. The front carries the attack settling and whatever
  // lookahead delay the implementation uses.
  let peak = 0;
  for (let i = Math.floor(length / 2); i < out.length; i++) {
    const magnitude = Math.abs(out[i]);
    if (magnitude > peak) peak = magnitude;
  }

  if (!(peak > 0) || !(amplitude > 0)) return 1;

  const gain = peak / amplitude;

  // A sanity band. A compressor that turns out to attenuate, or to add more
  // than 6 dB, is not doing what this function assumes, and guessing would be
  // worse than leaving it alone.
  return gain >= 0.5 && gain <= 2 ? gain : 1;
}
