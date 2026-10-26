import { describe, expect, it } from "vitest";
import { formatRunDuration } from "../run-duration";

describe("formatRunDuration", () => {
  it("reads minutes and seconds the way a person would say them", () => {
    expect(formatRunDuration((5 * 60 + 24) * 1000)).toBe("5 mins, 24 seconds");
  });

  it("uses the singular for one, and leaves out a unit that is zero", () => {
    expect(formatRunDuration(60_000)).toBe("1 min");
    expect(formatRunDuration(61_000)).toBe("1 min, 1 second");
    expect(formatRunDuration(1_000)).toBe("1 second");
    expect(formatRunDuration(24_000)).toBe("24 seconds");
  });

  it("counts hours without listing the seconds of a long run", () => {
    expect(formatRunDuration((3600 + 3 * 60 + 9) * 1000)).toBe("1 hr, 3 mins");
    expect(formatRunDuration(2 * 3600 * 1000)).toBe("2 hrs");
    expect(formatRunDuration(3_600_000)).toBe("1 hr");
  });

  it("rounds to the nearest second", () => {
    expect(formatRunDuration(24_400)).toBe("24 seconds");
    expect(formatRunDuration(24_600)).toBe("25 seconds");
  });

  it("says so when a run took under a second, or its clock ran backwards", () => {
    expect(formatRunDuration(300)).toBe("less than a second");
    expect(formatRunDuration(0)).toBe("less than a second");
    expect(formatRunDuration(-5_000)).toBe("less than a second");
    expect(formatRunDuration(Number.NaN)).toBe("less than a second");
  });
});
