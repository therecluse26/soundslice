/**
 * One animation frame loop, for every meter on the page.
 *
 * Four meters on a card, three cards on screen, is twelve
 * `requestAnimationFrame` loops if each meter drives its own — twelve callbacks
 * the browser schedules separately, each one reading its own clock and each one
 * arriving at a slightly different time. The meters would drift apart on
 * screen while showing the same audio.
 *
 * So there is one loop. It starts when the first meter subscribes and stops
 * when the last one leaves, and every meter in a frame is handed **the same**
 * timestamp and the same elapsed time. Two meters showing one signal then move
 * together, which is the only way an input and an output meter can be compared
 * by eye.
 *
 * ## Why the time comes from here and not from each meter
 *
 * `advanceMeter` decays by elapsed seconds, not by frames. A meter that read
 * its own clock would compute a slightly different `dtSec` from its neighbour
 * and the two bars would fall at different speeds. One clock, one answer.
 */

/**
 * What a meter does with a frame.
 *
 * `nowMs` is the frame's timestamp and `dtSec` is the time since the last
 * frame, in seconds.
 */
export type MeterTick = (nowMs: number, dtSec: number) => void;

const ticks = new Set<MeterTick>();

let frame = 0;
let previousMs = 0;

/**
 * The longest elapsed time a single frame may report, in seconds.
 *
 * A backgrounded tab stops getting frames. Coming back after a minute would
 * hand the first frame a `dtSec` of 60, and every meter would snap to the floor
 * in one step. Clamping to a tenth of a second makes that first frame look like
 * a slow one instead — the meters catch up over the next few frames and nothing
 * jumps.
 */
const MAX_FRAME_SEC = 0.1;

function run(nowMs: number): void {
  const dtSec = Math.min(MAX_FRAME_SEC, Math.max(0, (nowMs - previousMs) / 1000));
  previousMs = nowMs;

  // Copied, because a meter may unsubscribe from inside its own tick — a card
  // unmounting mid-frame does exactly that, and mutating a `Set` while
  // iterating it is how that becomes an intermittent bug nobody can reproduce.
  for (const tick of [...ticks]) tick(nowMs, dtSec);

  frame = ticks.size > 0 ? requestAnimationFrame(run) : 0;
}

/**
 * Adds a meter to the loop. Returns the function that takes it out again.
 *
 * Safe to call before the first frame and safe to call the returned function
 * more than once.
 */
export function joinMeterLoop(tick: MeterTick): () => void {
  ticks.add(tick);

  if (frame === 0) {
    // The first frame gets a `dtSec` of 0 rather than the time since the page
    // loaded, which would be minutes.
    previousMs = performance.now();
    frame = requestAnimationFrame(run);
  }

  return () => {
    ticks.delete(tick);

    if (ticks.size === 0 && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

