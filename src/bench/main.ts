/**
 * Engine benchmark harness — ticket 001, "Measure performance baselines".
 *
 * Standing rule 4 on the map says Simple view must not regress. This harness
 * produces the numbers that rule is measured against, and ticket 008 re-runs it
 * to prove the rewrite did not get slower.
 *
 * It imports the shipped modules unchanged. Nothing under src/lib or
 * src/components is instrumented, because instrumenting the code under
 * measurement would corrupt the number.
 *
 * Entry point is bench.html, a dev-only Vite entry. Vite's default build input
 * is index.html alone, so this never reaches the production bundle.
 *
 * ## What ticket 008 changed about the stages
 *
 * The old harness timed `AudioTrimmer.trimAudio` and `applyProcessingPipeline`
 * separately. Neither exists: the trim is now one `start(0, offset, duration)`
 * call inside the render, and the pipeline is one graph. So those two rows are
 * replaced by one — **render only** — which covers exactly the same work.
 *
 * The encode rows pass `transfer: false`. Transferring detaches the buffer, and
 * these rows time the same buffer three times. The production path transfers;
 * `encodeWavTransferred` times that separately, once.
 */

import { AudioLoader } from "@/lib/audio-loader";
import { AudioService, OutputFormat } from "@/lib/audio-service";
import { encode } from "@/lib/encoder";
import { renderRegions } from "@/lib/render";
import { simpleStack, defaultRegion } from "@/lib/edit-stack";
import { sniffSampleRate } from "@/lib/audio-format";
import { integratedLoudness, truePeakDb } from "@/lib/loudness";
import type { EditorTrack } from "@/stores/audio-store";

const RUNS = 3;
const BATCH_TRACKS = 10;

const ALL_FILES = [
  "clip-30s.wav",
  "clip-30s.mp3",
  "track-5m.wav",
  "track-5m.mp3",
  "podcast-45m.wav",
  "podcast-45m.mp3",
];

/** One timed measurement: every run, plus the median. */
type Measurement = {
  runs: number[];
  medianMs: number | null;
  peakHeapMB: number | null;
  error?: string;
};

type FileResult = {
  file: string;
  bytes: number;
  durationSec: number | null;
  sampleRate: number | null;
  sniffedRate: number | null;
  channels: number | null;
  measurements: Record<string, Measurement>;
};

const logEl = document.getElementById("log") as HTMLDivElement;

function say(msg: string, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  // eslint-disable-next-line no-console
  console.log(msg);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * performance.memory is Chromium-only, and is coarse unless Chromium is
 * launched with --enable-precise-memory-info. Null means "this browser does not
 * report it", which is a fact worth recording rather than hiding.
 */
function heapBytes(): number | null {
  const mem = (performance as any).memory;
  return mem && typeof mem.usedJSHeapSize === "number"
    ? mem.usedJSHeapSize
    : null;
}

/** Runs one operation RUNS times, timing each and tracking the heap high-water mark. */
async function measure(
  label: string,
  op: () => Promise<void> | void,
  runs_ = RUNS
): Promise<Measurement> {
  const runs: number[] = [];
  let peak = 0;
  let sawHeap = false;

  const sampler = window.setInterval(() => {
    const h = heapBytes();
    if (h !== null) {
      sawHeap = true;
      if (h > peak) peak = h;
    }
  }, 100);

  try {
    for (let i = 0; i < runs_; i++) {
      const before = heapBytes();
      if (before !== null) {
        sawHeap = true;
        if (before > peak) peak = before;
      }
      const t0 = performance.now();
      await op();
      const elapsed = performance.now() - t0;
      runs.push(elapsed);
      say(`      run ${i + 1}: ${elapsed.toFixed(1)} ms`);
      // Give the collector a chance between runs so one run's garbage is not
      // charged to the next run's peak.
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    window.clearInterval(sampler);
    const message = err instanceof Error ? err.message : String(err);
    say(`      FAILED: ${message}`, "err");
    return {
      runs,
      medianMs: median(runs),
      peakHeapMB: sawHeap ? +(peak / 1048576).toFixed(1) : null,
      error: message,
    };
  }

  window.clearInterval(sampler);
  const result: Measurement = {
    runs: runs.map((r) => +r.toFixed(1)),
    medianMs: +(median(runs) as number).toFixed(1),
    peakHeapMB: sawHeap ? +(peak / 1048576).toFixed(1) : null,
  };
  say(`   ${label}: median ${result.medianMs} ms`, "ok");
  return result;
}

async function fetchAsFile(name: string): Promise<File> {
  const res = await fetch(`/bench-audio/${name}`);
  if (!res.ok) {
    throw new Error(
      `bench-audio/${name} not found (${res.status}). Run scripts/fetch-bench-audio.sh`
    );
  }
  const blob = await res.blob();
  const type = name.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
  return new File([blob], name, { type });
}

/**
 * The measured region is the whole track. That is the worst case, and it is
 * deterministic, so two runs of this harness compare directly.
 *
 * `defaultRegion` gives it 0 dB of region gain and the 20 ms fade edges every
 * slice has always had, so this is the same audio the old harness measured.
 */
function trackFor(file: File, durationSec: number): EditorTrack {
  // One region, so `AudioService.sliceTrack` measures exactly the work it
  // measured before ticket 021 gave a track many. `sliceTrack` renders the first
  // region by start time, and with one region that is the only region.
  return { file, regions: [defaultRegion(0, durationSec)] };
}

const SWITCHES_OFF = {
  normalizeAudio: false,
  applyPostProcessing: false,
  exportFileType: OutputFormat.WAV,
};

const SWITCHES_ON = {
  normalizeAudio: true,
  applyPostProcessing: true,
  exportFileType: OutputFormat.WAV,
};

async function measureFile(name: string): Promise<FileResult> {
  say(`\n── ${name} ──`);
  const file = await fetchAsFile(name);
  say(`   ${(file.size / 1048576).toFixed(1)} MB on disk`);

  const result: FileResult = {
    file: name,
    bytes: file.size,
    durationSec: null,
    sampleRate: null,
    sniffedRate: null,
    channels: null,
    measurements: {},
  };

  // `AudioLoader.sampleRateOf`, not `sniffSampleRate` on the first window.
  // A file with a large ID3 tag needs the second look past the tag, and
  // reporting the one-window answer here reads as "unknown format" for a file
  // the loader reads perfectly.
  result.sniffedRate = await AudioLoader.sampleRateOf(file);

  // Probe once, outside the timed runs, to record the decoded shape.
  try {
    const probe = await AudioLoader.loadAudioFile(file);
    result.durationSec = +probe.duration.toFixed(3);
    result.sampleRate = probe.sampleRate;
    result.channels = probe.numberOfChannels;
    say(
      `   decoded: ${result.durationSec}s, ${result.sampleRate} Hz, ` +
        `${result.channels} ch (header said ${result.sniffedRate ?? "nothing"})`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    say(`   probe FAILED: ${message}`, "err");
    result.measurements.decode = {
      runs: [],
      medianMs: null,
      peakHeapMB: null,
      error: message,
    };
    return result;
  }

  const duration = result.durationSec as number;

  // 1. Decode — one `decodeAudioData`, at the file's own rate. It used to
  //    decode and then re-render the result through an OfflineAudioContext that
  //    changed nothing.
  say(`   decode (AudioLoader.loadAudioFile)`);
  result.measurements.decode = await measure("decode", async () => {
    const buf = await AudioLoader.loadAudioFile(file);
    void buf.length;
  });

  // 2. Slice end to end, every switch off, exporting WAV.
  say(`   slice, switches off (AudioService.sliceTrack, WAV)`);
  result.measurements.sliceAllOffWav = await measure("slice off", async () => {
    const blob = await AudioService.sliceTrack(
      trackFor(file, duration),
      SWITCHES_OFF
    );
    void blob?.size;
  });

  // 3. Slice end to end, normalize and post-processing on, exporting WAV.
  say(`   slice, normalize + post-processing on (WAV)`);
  result.measurements.sliceProcessedWav = await measure(
    "slice on",
    async () => {
      const blob = await AudioService.sliceTrack(
        trackFor(file, duration),
        SWITCHES_ON
      );
      void blob?.size;
    }
  );

  // 4. Stage breakdown, so a later ticket can see which stage regressed rather
  //    than only that something did.
  let decoded: AudioBuffer | null = null;
  try {
    decoded = await AudioLoader.loadAudioFile(file);
  } catch (err) {
    say(
      `   stage setup FAILED: ${
        err instanceof Error ? err.message : String(err)
      }`,
      "err"
    );
  }

  if (decoded) {
    const source = decoded;
    const region = defaultRegion(0, duration);

    // Replaces the old "trim only" and "pipeline only" rows together. The trim
    // is inside this now, and so is every effect.
    say(`   render only, switches off (renderRegions, 1 pass)`);
    result.measurements.renderOff = await measure("render off", async () => {
      const out = await renderRegions(source, [region], simpleStack(SWITCHES_OFF));
      void out.length;
    });

    say(`   render only, switches on (renderRegions, 3 passes)`);
    result.measurements.renderOn = await measure("render on", async () => {
      const out = await renderRegions(source, [region], simpleStack(SWITCHES_ON));
      void out.length;
    });

    // What attaching the progress worklet costs. Standing rule 7 wants
    // progress; this is the price of it, and it was not measured before.
    say(`   render only, switches off, with progress worklet`);
    result.measurements.renderOffWithProgress = await measure(
      "render off + progress",
      async () => {
        const out = await renderRegions(
          source,
          [region],
          simpleStack(SWITCHES_OFF),
          { onProgress: () => {} }
        );
        void out.length;
      }
    );

    const rendered = await renderRegions(
      source,
      [region],
      simpleStack(SWITCHES_OFF)
    );

    say(`   encode WAV only (worker, channels copied)`);
    result.measurements.encodeWav = await measure("encode wav", async () => {
      const blob = await encode(rendered, OutputFormat.WAV, {
        transfer: false,
      }).done;
      void blob?.size;
    });

    say(`   encode MP3 only (shine.js in worker, 320 kbps, channels copied)`);
    result.measurements.encodeMp3 = await measure("encode mp3", async () => {
      const blob = await encode(rendered, OutputFormat.MP3, {
        transfer: false,
      }).done;
      void blob?.size;
    });

    // One run only. Transferring detaches the buffer, so there is no second run
    // to give. This is the number the app actually pays.
    say(`   encode WAV only, channels transferred (one run)`);
    result.measurements.encodeWavTransferred = await measure(
      "encode wav transferred",
      async () => {
        const fresh = await renderRegions(
          source,
          [region],
          simpleStack(SWITCHES_OFF)
        );
        const blob = await encode(fresh, OutputFormat.WAV).done;
        void blob?.size;
      },
      1
    );
  }

  return result;
}

/**
 * Batch export. Ten copies of the 30-second clip, not ten 45-minute podcasts —
 * ten 45-minute tracks decode to roughly 9.5 GB and cannot fit. The choice is
 * recorded in the baselines file so a later run repeats it exactly.
 */
async function measureBatch(): Promise<Measurement> {
  say(`\n── batch export, ${BATCH_TRACKS} x clip-30s.wav ──`);
  const file = await fetchAsFile("clip-30s.wav");
  const probe = await AudioLoader.loadAudioFile(file);
  const duration = probe.duration;

  const tracks = Array.from({ length: BATCH_TRACKS }, (_, i) =>
    trackFor(
      new File([file], `clip-30s-${i}.wav`, { type: "audio/wav" }),
      duration
    )
  );

  return measure("batch zip", async () => {
    const zip = await AudioService.sliceAllFilesIntoZip(tracks, SWITCHES_OFF);
    void zip.size;
  });
}

async function run(files: string[]) {
  logEl.textContent = "";
  const started = new Date().toISOString();
  say(`Started ${started}`);
  say(`Runs per measurement: ${RUNS}, median kept.`);
  if (heapBytes() === null) {
    say(
      "performance.memory is unavailable — no heap numbers in this browser.",
      "warn"
    );
  }

  const results: FileResult[] = [];
  for (const name of files) {
    try {
      results.push(await measureFile(name));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      say(`── ${name} SKIPPED: ${message}`, "err");
      results.push({
        file: name,
        bytes: 0,
        durationSec: null,
        sampleRate: null,
        sniffedRate: null,
        channels: null,
        measurements: {
          fatal: { runs: [], medianMs: null, peakHeapMB: null, error: message },
        },
      });
    }
  }

  let batch: Measurement | null = null;
  try {
    batch = await measureBatch();
  } catch (err) {
    say(
      `batch SKIPPED: ${err instanceof Error ? err.message : String(err)}`,
      "err"
    );
  }

  const report = {
    started,
    finished: new Date().toISOString(),
    runsPerMeasurement: RUNS,
    batchTrackCount: BATCH_TRACKS,
    regionMeasured: "whole track (start 0 to end of file)",
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as any).deviceMemory ?? null,
    heapReported: heapBytes() !== null,
    files: results,
    batchZip: batch,
  };

  (window as any).__benchReport = report;
  say(`\nDone. Report is on window.__benchReport.`, "ok");
  return report;
}

(window as any).__bench = {
  run,
  runAll: () => run(ALL_FILES),
  runQuick: () => run(["clip-30s.wav", "clip-30s.mp3"]),
  ALL_FILES,
  // Exposed so a single stage can be probed alone. The 45-minute files can
  // exhaust the tab, and a whole-file run cannot tell you which stage did it.
  lib: {
    AudioLoader,
    AudioService,
    OutputFormat,
    encode,
    renderRegions,
    simpleStack,
    defaultRegion,
    sniffSampleRate,
    fetchAsFile,
    trackFor,
    measure,
    SWITCHES_OFF,
    SWITCHES_ON,
    // Ticket 010's acceptance is measured, not listened to: two tracks at very
    // different levels, both normalized, must read the same LUFS.
    integratedLoudness,
    truePeakDb,
  },
};

document.getElementById("run")?.addEventListener("click", () => {
  void run(ALL_FILES);
});
document.getElementById("quick")?.addEventListener("click", () => {
  void run(["clip-30s.wav", "clip-30s.mp3"]);
});

say("Harness loaded. window.__bench.runAll() or window.__bench.runQuick().");
