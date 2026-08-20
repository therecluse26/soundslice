import { describe, expect, it } from "vitest";
import {
  GAIN_DETENT_DB,
  REGION_GAIN_RANGE,
  clampFadeMs,
  fadeAfterDrag,
  fadeWidthPx,
  formatFade,
  formatGain,
  gainAfterDrag,
  gainAtFraction,
  gainLineFraction,
  snapGain,
} from "./region-geometry";

describe("gainLineFraction", () => {
  it("puts the loudest gain at the top and the quietest at the bottom", () => {
    // Top is loudest, so dragging up means louder. That is the way round every
    // DAW draws a clip gain line.
    expect(gainLineFraction(REGION_GAIN_RANGE.max)).toBe(0);
    expect(gainLineFraction(REGION_GAIN_RANGE.min)).toBe(1);
  });

  it("puts 0 dB a third of the way down, on a −24 to +12 range", () => {
    expect(gainLineFraction(0)).toBeCloseTo(12 / 36, 6);
  });

  it("clamps a gain from outside the range onto the region", () => {
    expect(gainLineFraction(999)).toBe(0);
    expect(gainLineFraction(-999)).toBe(1);
  });
});

describe("gainAtFraction", () => {
  it("is the inverse of gainLineFraction", () => {
    for (const db of [-24, -12, -6, 3, 12]) {
      expect(gainAtFraction(gainLineFraction(db))).toBeCloseTo(db, 6);
    }
  });

  it("clamps a fraction from outside the region", () => {
    expect(gainAtFraction(-1)).toBe(REGION_GAIN_RANGE.max);
    expect(gainAtFraction(2)).toBe(REGION_GAIN_RANGE.min);
  });
});

describe("snapGain", () => {
  it("rounds to a tenth of a decibel", () => {
    expect(snapGain(-6.04)).toBe(-6);
    expect(snapGain(-6.06)).toBe(-6.1);
  });

  it("snaps to exactly 0 near unity", () => {
    // The detent. Hitting 0.0 by hand on a 100-pixel region is not possible,
    // and "back to where it was" is the most common thing to ask of clip gain.
    expect(snapGain(GAIN_DETENT_DB - 0.05)).toBe(0);
    expect(snapGain(-GAIN_DETENT_DB + 0.05)).toBe(0);
  });

  it("does not swallow a gain the user meant", () => {
    expect(snapGain(0.5)).toBe(0.5);
    expect(snapGain(-0.5)).toBe(-0.5);
  });
});

describe("gainAfterDrag", () => {
  const height = 100;

  it("makes a region louder when the drag goes up", () => {
    // Up is negative dy in screen coordinates.
    expect(gainAfterDrag(0, -10, height)).toBeCloseTo(3.6, 6);
  });

  it("makes a region quieter when the drag goes down", () => {
    expect(gainAfterDrag(0, 10, height)).toBeCloseTo(-3.6, 6);
  });

  it("measures from where the drag started, not from the last frame", () => {
    // A slow drag and a fast one over the same distance must end in the same
    // place. Frame-by-frame maths drifts; this cannot.
    expect(gainAfterDrag(0, 30, height)).toBe(gainAfterDrag(0, 30, height));
    expect(gainAfterDrag(-6, 0, height)).toBe(-6);
  });

  it("stops at the ends of the range", () => {
    expect(gainAfterDrag(0, -1000, height)).toBe(REGION_GAIN_RANGE.max);
    expect(gainAfterDrag(0, 1000, height)).toBe(REGION_GAIN_RANGE.min);
  });

  it("answers for a region with no height", () => {
    expect(gainAfterDrag(-6, 40, 0)).toBe(-6);
  });
});

describe("clampFadeMs", () => {
  it("never lets a fade go negative", () => {
    expect(clampFadeMs(-50, 10)).toBe(0);
  });

  it("lets a fade be as long as the whole region", () => {
    // Two fades that together overrun are not an error: `fadeTimes` shortens
    // both to fit, which is the rule that stops a short region dipping in the
    // middle.
    expect(clampFadeMs(99999, 2)).toBe(2000);
  });

  it("rounds to a whole millisecond", () => {
    expect(clampFadeMs(205.4, 10)).toBe(205);
  });
});

describe("fadeWidthPx", () => {
  it("is the fade's share of the region's width", () => {
    expect(fadeWidthPx(500, 400, 2)).toBeCloseTo(100, 6);
  });

  it("never draws past the region", () => {
    expect(fadeWidthPx(9999, 400, 2)).toBe(400);
  });

  it("answers before the waveform has a width", () => {
    expect(fadeWidthPx(500, 0, 2)).toBe(0);
    expect(fadeWidthPx(500, 400, 0)).toBe(0);
  });
});

describe("fadeAfterDrag", () => {
  const width = 400;
  const duration = 2;

  it("lengthens the fade in when its grip moves right", () => {
    expect(fadeAfterDrag(0, 100, width, duration, 1)).toBe(500);
  });

  it("lengthens the fade out when its grip moves left", () => {
    expect(fadeAfterDrag(0, -100, width, duration, -1)).toBe(500);
  });

  it("shortens a fade dragged back the other way", () => {
    expect(fadeAfterDrag(500, -100, width, duration, 1)).toBe(0);
  });

  it("stops at zero rather than going negative", () => {
    expect(fadeAfterDrag(100, -9999, width, duration, 1)).toBe(0);
  });

  it("measures from where the drag started", () => {
    expect(fadeAfterDrag(200, 0, width, duration, 1)).toBe(200);
  });

  it("answers before the waveform has a width", () => {
    expect(fadeAfterDrag(200, 50, 0, duration, 1)).toBe(200);
  });
});

describe("the readouts", () => {
  it("signs a gain, and uses a real minus sign", () => {
    expect(formatGain(3)).toBe("+3.0 dB");
    expect(formatGain(0)).toBe("0.0 dB");
    expect(formatGain(-6.5)).toBe("−6.5 dB");
  });

  it("shows a short fade in milliseconds and a long one in seconds", () => {
    expect(formatFade(205)).toBe("205 ms");
    expect(formatFade(999)).toBe("999 ms");
    expect(formatFade(1200)).toBe("1.20 s");
  });
});
