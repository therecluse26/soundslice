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
 */

import { AudioLoader } from "@/lib/audio-loader";
import { AudioTrimmer } from "@/lib/audio-trimmer";
import { AudioService, OutputFormat } from "@/lib/audio-service";
import { applyProcessingPipeline } from "@/lib/audio-processors";
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
  op: () => Promise<void> | void
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
    for (let i = 0; i < RUNS; i++) {
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
 * AudioService.sliceAudio only reads .start and .end off selectedRegion, so a
 * plain object is enough. It never needs a real wavesurfer Region — itself a
 * finding for ticket 009, which wants the plugin object out of the store.
 */
function trackFor(file: File, durationSec: number): EditorTrack {
  return {
    file,
    selectedRegion: { start: 0, end: durationSec } as any,
  };
}

/** Blob URLs pin their blob in memory until revoked. A 45-minute WAV is ~476 MB. */
function release(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

async function measureFile(name: string): Promise<FileResult> {
  say(`\n── ${name} ──`);
  const file = await fetchAsFile(name);
  say(`   ${(file.size / 1048576).toFixed(1)} MB on disk`);

  const result: FileResult = {
    file: name,
    bytes: file.size,
    durationSec: null,
    sampleRate: null,
    channels: null,
    measurements: {},
  };

  // Probe once, outside the timed runs, to record the decoded shape.
  try {
    const probe = await AudioLoader.loadAudioFile(file);
    result.durationSec = +probe.duration.toFixed(3);
    result.sampleRate = probe.sampleRate;
    result.channels = probe.numberOfChannels;
    say(
      `   decoded: ${result.durationSec}s, ${result.sampleRate} Hz, ${result.channels} ch`
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

  // 1. Decode — AudioLoader.loadAudioFile. Note this both decodes and then
  //    re-renders through an OfflineAudioContext, which is redundant work.
  say(`   decode (AudioLoader.loadAudioFile)`);
  result.measurements.decode = await measure("decode", async () => {
    const buf = await AudioLoader.loadAudioFile(file);
    void buf.length;
  });

  // 2. Slice end to end, every switch off, exporting WAV.
  say(`   slice, switches off (AudioService.sliceAudio, WAV)`);
  result.measurements.sliceAllOffWav = await measure(
    "slice off",
    async () => {
      const url = await AudioService.sliceAudio(
        trackFor(file, duration),
        false,
        false,
        false,
        OutputFormat.WAV
      );
      release(url);
    }
  );

  // 3. Slice end to end, normalize and post-processing on, exporting WAV.
  say(`   slice, normalize + post-processing on (WAV)`);
  result.measurements.sliceProcessedWav = await measure(
    "slice on",
    async () => {
      const url = await AudioService.sliceAudio(
        trackFor(file, duration),
        true,
        true,
        false,
        OutputFormat.WAV
      );
      release(url);
    }
  );

  // 4. Stage breakdown, so ticket 008 can see which stage regressed rather
  //    than only that something did.
  let staged: AudioBuffer | null = null;
  try {
    staged = AudioTrimmer.trimAudio(
      await AudioLoader.loadAudioFile(file),
      0,
      duration
    );
  } catch (err) {
    say(
      `   stage setup FAILED: ${err instanceof Error ? err.message : String(err)}`,
      "err"
    );
  }

  if (staged) {
    const trimmed = staged;

    say(`   trim only (AudioTrimmer.trimAudio)`);
    result.measurements.trimOnly = await measure("trim", async () => {
      const out = AudioTrimmer.trimAudio(trimmed, 0, trimmed.duration);
      void out.length;
    });

    say(`   pipeline only (applyProcessingPipeline, normalize + compress)`);
    result.measurements.pipelineOnly = await measure("pipeline", async () => {
      const out = await applyProcessingPipeline(trimmed, {
        normalize: true,
        compress: true,
        trimSilence: false,
      });
      void out.length;
    });

    say(`   encode WAV only (worker)`);
    result.measurements.encodeWav = await measure("encode wav", async () => {
      const url = await AudioTrimmer.createDownloadLink(
        trimmed,
        "bench.wav",
        OutputFormat.WAV
      );
      release(url);
    });

    say(`   encode MP3 only (shine.js in worker, 320 kbps)`);
    result.measurements.encodeMp3 = await measure("encode mp3", async () => {
      const url = await AudioTrimmer.createDownloadLink(
        trimmed,
        "bench.mp3",
        OutputFormat.MP3
      );
      release(url);
    });
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

  const tracks = {
    current: Array.from({ length: BATCH_TRACKS }, (_, i) =>
      trackFor(
        new File([file], `clip-30s-${i}.wav`, { type: "audio/wav" }),
        duration
      )
    ),
  };

  return measure("batch zip", async () => {
    const url = await AudioService.sliceAllFilesIntoZip(
      tracks as any,
      false,
      false,
      false,
      OutputFormat.WAV
    );
    release(url);
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
    AudioTrimmer,
    AudioService,
    applyProcessingPipeline,
    OutputFormat,
    fetchAsFile,
    trackFor,
    measure,
    release,
  },
};

document.getElementById("run")?.addEventListener("click", () => {
  void run(ALL_FILES);
});
document.getElementById("quick")?.addEventListener("click", () => {
  void run(["clip-30s.wav", "clip-30s.mp3"]);
});

say("Harness loaded. window.__bench.runAll() or window.__bench.runQuick().");
