import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_DEPTH,
  History,
  HistoryEntry,
  changedFileNames,
  pushEntry,
  redoEntry,
  snapshotTrack,
  snapshotsEqual,
  undoEntry,
} from "./history";
import { Region, defaultRegion } from "./edit-stack";

function at(id: string, start: number, end: number): Region {
  return { ...defaultRegion(start, end), id };
}

/** One gesture on one track, from one region list to another. */
function gesture(
  label: string,
  before: Region[],
  after: Region[],
  coalesceKey?: string,
  fileName = "a.wav"
): HistoryEntry {
  return {
    label,
    before: [snapshotTrack(fileName, before)],
    after: [snapshotTrack(fileName, after)],
    coalesceKey,
  };
}

const ONE = [at("r1", 0, 10)];
const TWO = [at("r1", 0, 10), at("r2", 20, 30)];
const THREE = [at("r1", 0, 10), at("r2", 20, 30), at("r3", 40, 50)];

describe("snapshotTrack", () => {
  it("copies the regions, so a later edit cannot rewrite the past", () => {
    const regions = [at("r1", 0, 10)];
    const snapshot = snapshotTrack("a.wav", regions);

    regions[0].start = 5;
    regions[0].fade.inMs = 500;

    expect(snapshot.regions[0].start).toBe(0);
    expect(snapshot.regions[0].fade.inMs).toBe(20);
  });

  it("keeps the selection, so undo puts the highlight back too", () => {
    expect(snapshotTrack("a.wav", ONE, "r1").selectedRegionId).toBe("r1");
  });
});

describe("pushEntry", () => {
  it("records a gesture", () => {
    const history = pushEntry(EMPTY_HISTORY, gesture("Add region", ONE, TWO));
    expect(history.past).toHaveLength(1);
  });

  it("records nothing for a gesture that changed nothing", () => {
    // Clicking a region writes its bounds back unchanged. A stack full of those
    // would make Ctrl+Z look broken.
    expect(pushEntry(EMPTY_HISTORY, gesture("Move region", ONE, ONE)).past)
      .toHaveLength(0);
  });

  it("coalesces two pushes that share a key into one entry", () => {
    // A slider fires on every pixel of its drag. All of them are one gesture.
    const first = pushEntry(
      EMPTY_HISTORY,
      gesture("Region gain", ONE, TWO, "gain:r1:0")
    );
    const second = pushEntry(
      first,
      gesture("Region gain", TWO, THREE, "gain:r1:0")
    );

    expect(second.past).toHaveLength(1);
  });

  it("keeps the start of a coalesced gesture, not its last frame", () => {
    // The whole point: undo has to return to where the drag began.
    const first = pushEntry(
      EMPTY_HISTORY,
      gesture("Region gain", ONE, TWO, "gain:r1:0")
    );
    const second = pushEntry(
      first,
      gesture("Region gain", TWO, THREE, "gain:r1:0")
    );

    expect(second.past[0].before[0].regions).toHaveLength(1);
    expect(second.past[0].after[0].regions).toHaveLength(3);
  });

  it("keeps two gestures apart when the key differs", () => {
    // Letting go of a slider bumps the key, so the next drag undoes separately.
    const first = pushEntry(
      EMPTY_HISTORY,
      gesture("Region gain", ONE, TWO, "gain:r1:0")
    );
    const second = pushEntry(
      first,
      gesture("Region gain", TWO, THREE, "gain:r1:1")
    );

    expect(second.past).toHaveLength(2);
  });

  it("drops a coalesced gesture that ends where it started", () => {
    // Drag a region away and back. There is nothing to undo to.
    const first = pushEntry(
      EMPTY_HISTORY,
      gesture("Region gain", ONE, TWO, "gain:r1:0")
    );
    const second = pushEntry(
      first,
      gesture("Region gain", TWO, ONE, "gain:r1:0")
    );

    expect(second.past).toHaveLength(0);
  });

  it("clears the future, because editing abandons the undone branch", () => {
    const recorded = pushEntry(EMPTY_HISTORY, gesture("Add region", ONE, TWO));
    const undone = undoEntry(recorded).history;

    expect(undone.future).toHaveLength(1);
    expect(pushEntry(undone, gesture("Add region", ONE, THREE)).future)
      .toHaveLength(0);
  });

  it("forgets the oldest gesture past its depth", () => {
    let history: History = EMPTY_HISTORY;

    for (let index = 0; index < HISTORY_DEPTH + 10; index++) {
      history = pushEntry(
        history,
        gesture(`Gesture ${index}`, ONE, [at(`r${index}`, index, index + 1)])
      );
    }

    expect(history.past).toHaveLength(HISTORY_DEPTH);
    expect(history.past[0].label).toBe("Gesture 10");
  });
});

describe("undoEntry and redoEntry", () => {
  it("gives back nothing when there is nothing to undo", () => {
    expect(undoEntry(EMPTY_HISTORY).entry).toBeNull();
    expect(redoEntry(EMPTY_HISTORY).entry).toBeNull();
  });

  it("hands back the gesture to reverse", () => {
    const history = pushEntry(EMPTY_HISTORY, gesture("Add region", ONE, TWO));
    const { entry, history: after } = undoEntry(history);

    expect(entry?.before[0].regions).toHaveLength(1);
    expect(after.past).toHaveLength(0);
    expect(after.future).toHaveLength(1);
  });

  it("restores the region list digit for digit", () => {
    // Ticket 024's acceptance. A region's bounds are floats a drag produced, so
    // "about the same" is not good enough.
    const exact = [{ ...at("r1", 1.2345678901234, 53.418351477449455) }];
    const history = pushEntry(
      EMPTY_HISTORY,
      gesture("Split on silence", exact, THREE)
    );

    expect(undoEntry(history).entry?.before[0].regions).toEqual(exact);
  });

  it("replays what it undid", () => {
    const history = pushEntry(EMPTY_HISTORY, gesture("Add region", ONE, TWO));
    const undone = undoEntry(history).history;
    const { entry, history: redone } = redoEntry(undone);

    expect(entry?.after[0].regions).toHaveLength(2);
    expect(redone.past).toHaveLength(1);
    expect(redone.future).toHaveLength(0);
  });

  it("replays two tracks in the order the gestures happened", () => {
    const first = pushEntry(
      EMPTY_HISTORY,
      gesture("Add region", ONE, TWO, undefined, "a.wav")
    );
    const second = pushEntry(
      first,
      gesture("Add region", ONE, THREE, undefined, "b.wav")
    );

    // The last gesture undoes first.
    const one = undoEntry(second);
    expect(one.entry?.before[0].fileName).toBe("b.wav");

    const two = undoEntry(one.history);
    expect(two.entry?.before[0].fileName).toBe("a.wav");
  });
});

describe("changedFileNames", () => {
  it("names the track an entry changed", () => {
    expect(changedFileNames(gesture("Add region", ONE, TWO))).toEqual([
      "a.wav",
    ]);
  });

  it("leaves out a track the gesture only looked at", () => {
    // Undo scrolls to what it changed. Scrolling to a card that did not move
    // would be worse than not scrolling at all.
    const entry: HistoryEntry = {
      label: "Add region",
      before: [snapshotTrack("a.wav", ONE), snapshotTrack("b.wav", ONE)],
      after: [snapshotTrack("a.wav", TWO), snapshotTrack("b.wav", ONE)],
    };

    expect(changedFileNames(entry)).toEqual(["a.wav"]);
  });
});

describe("snapshotsEqual", () => {
  it("is true for the same regions", () => {
    expect(
      snapshotsEqual([snapshotTrack("a.wav", ONE)], [snapshotTrack("a.wav", ONE)])
    ).toBe(true);
  });

  it("is false when a selection moved, because undo restores that too", () => {
    expect(
      snapshotsEqual(
        [snapshotTrack("a.wav", TWO, "r1")],
        [snapshotTrack("a.wav", TWO, "r2")]
      )
    ).toBe(false);
  });
});
