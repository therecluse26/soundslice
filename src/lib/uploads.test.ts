import { describe, expect, it } from "vitest";
import { areUploadsComplete } from "./uploads";

/**
 * The regression test for the defect in
 * `.wayfinder/tickets/016-export-empties-track-list.md`.
 *
 * The first case is the whole ticket. Everything else is there to prove the
 * guard did not break the normal path.
 */
describe("areUploadsComplete", () => {
  it("is false for an empty list", () => {
    expect(areUploadsComplete([])).toBe(false);
  });

  it("is false while one upload is still running", () => {
    expect(
      areUploadsComplete([{ isComplete: true }, { isComplete: false }])
    ).toBe(false);
  });

  it("is true when every upload is done", () => {
    expect(
      areUploadsComplete([{ isComplete: true }, { isComplete: true }])
    ).toBe(true);
  });

  it("is true for a single finished upload", () => {
    expect(areUploadsComplete([{ isComplete: true }])).toBe(true);
  });
});
