/**
 * The mark's sundial: where the dot sits on its arc for the time of day, and
 * what the mark tells a person it will do on a click.
 */
import { describe, expect, it } from "vitest";
import { describeMark, sundial } from "../src/components/ShiftManagerMark";

describe("the sundial", () => {
  it("starts at the arc's left end at midnight, tops it at noon, and ends at its right end", () => {
    expect(sundial(0)).toEqual({ x: 31, y: 24 });
    expect(sundial(720)).toEqual({ x: 75, y: 10 });
    expect(sundial(1440)).toEqual({ x: 119, y: 24 });
  });

  it("only moves right through the day, and is highest at noon", () => {
    const xs = [0, 360, 720, 1080, 1439].map((m) => sundial(m).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const noon = sundial(720).y;
    for (const m of [0, 360, 1080, 1439]) expect(sundial(m).y).toBeGreaterThan(noon);
  });
});

describe("what the mark says a click does", () => {
  it("names the theme it's in, and the one a click moves to", () => {
    expect(describeMark("day")).toBe("Theme: Day. Click for Evening.");
    expect(describeMark("evening")).toBe("Theme: Evening. Click for Night.");
    expect(describeMark("night")).toBe("Theme: Night. Click for Day.");
  });
});
