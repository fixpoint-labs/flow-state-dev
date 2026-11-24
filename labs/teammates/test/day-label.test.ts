/** A day break in the conversation says Today, Yesterday or the date. */
import { describe, expect, it } from "vitest";
import { dayLabel } from "../src/lib/day-label";

describe("a day break", () => {
  it("says Today, Yesterday, or the date", () => {
    const now = new Date(2026, 10, 24, 15, 0).getTime();
    expect(dayLabel(new Date(2026, 10, 24, 0, 5).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 23, 23, 55).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 20, 12, 0).getTime(), now)).toMatch(/20/);
    expect(dayLabel(new Date(2026, 10, 20, 12, 0).getTime(), now)).not.toMatch(/Today|Yesterday/);
  });
});
