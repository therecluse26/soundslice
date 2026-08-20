/**
 * The preview path — the same stack, in a live `AudioContext`.
 *
 * There is no second implementation here. `buildGraph` is the same function the
 * export path calls, given a different context. That is
 * [ADR 0001](../../docs/adr/0001-one-graph-two-contexts.md): both contexts run
 * the same nodes with the same settings at the same 128-sample block size, so
 * **what you hear and what you export cannot disagree**.
 *
 * ## What is built and what is not
 *
 * This module is the path. Nothing calls it yet.
 *
 * The card's play button drives wavesurfer, which owns its own `<audio>`
 * element and its own playhead, scroll and region-out handling. Moving playback
 * onto this graph is a UI change with its own risks, and it is the "Preview"
 * feature's work, not this ticket's. Ticket 008 asked for the path; the path is
 * here, it shares `buildGraph`, and the benchmark harness exercises it.
 */

import { EditStack, Region } from "./edit-stack";
import { buildGraph, compressorSettingsIn } from "./graph";
import { calibrateAll } from "./compressor-calibration";
import { measureStack } from "./render";
import { sharedAudioContext } from "./audio-context";

export type PreviewOptions = {
  /**
   * The **Preview effects** switch, from the design's section 7.
   *
   * Off means you hear the cut with the region's own gain and fades, and the
   * track's whole stack is bypassed. This is the only sanctioned way for
   * preview to differ from export, and the user asks for it explicitly. It is
   * not per operation and it is never silent.
   */
  effects?: boolean;

  /**
   * Gains already measured for this stack, from an earlier render.
   *
   * Reusing them is what "loudness is briefly stale after an edit" means:
   * playback continues on the last completed measurement rather than stopping
   * to take a new one.
   */
  measured?: Map<number, number>;

  /** Called once when the region reaches its end and playback stops itself. */
  onEnded?: () => void;
};

export type PreviewHandle = {
  /** Stops now and releases the graph. Safe to call twice. */
  stop: () => void;
  /** The measurements this preview used, so the next one can reuse them. */
  measured: Map<number, number>;
};

/** A short lead-in, so the graph is connected before the first sample is due. */
const LEAD_IN_SEC = 0.05;

export async function startPreview(
  source: AudioBuffer,
  region: Region,
  stack: EditStack,
  options: PreviewOptions = {}
): Promise<PreviewHandle> {
  const effects = options.effects ?? true;
  const context = sharedAudioContext();

  // A context created before any user gesture starts suspended. Playing is a
  // gesture, so this resolves immediately in practice.
  if (context.state === "suspended") await context.resume();

  // `buildGraph` reads the calibration cache synchronously, and reusing a
  // caller's `measured` skips `measureStack`, which is where the export path
  // calibrates. Preview must not be the one path that leaves the makeup gain in.
  await calibrateAll(compressorSettingsIn(effects ? stack : []));

  const measured =
    options.measured ??
    (effects ? await measureStack(source, region, stack) : new Map());

  const graph = buildGraph(context, {
    source,
    region,
    stack,
    measured,
    // Bypass is `upTo: 0` — the region's cut, gain and fades, and no more.
    upTo: effects ? undefined : 0,
    startTime: context.currentTime + LEAD_IN_SEC,
  });

  graph.tail.connect(context.destination);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      graph.source.stop();
    } catch {
      // Already stopped, or never started. Nothing to undo.
    }
    graph.tail.disconnect();
  };

  graph.source.onended = () => {
    stop();
    options.onEnded?.();
  };

  graph.source.start(
    context.currentTime + LEAD_IN_SEC,
    region.start,
    graph.durationSec
  );

  return { stop, measured };
}
