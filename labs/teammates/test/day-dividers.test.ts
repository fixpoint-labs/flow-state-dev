/**
 * The conversation's day dividers. A conversation runs for days, so a reader
 * scrolling back needs to see where one day ends: a divider goes only where
 * two lines in a row fall on different local days, named so the recent ones
 * read at a glance (Today, Yesterday) and older ones by their date.
 */
import type { ItemLine } from "@flow-state-dev/react";
import { describe, expect, it } from "vitest";
import { dayBreaks, dayLabel, lineTime } from "../src/lib/days";

/** Local time, so the test holds in any time zone. */
const at = (month: number, day: number, hour = 12, year = 2026) => new Date(year, month - 1, day, hour).getTime();
const now = new Date(at(11, 20, 15));

describe("dayLabel", () => {
  it("names today and yesterday by local calendar day, not by 24 hours", () => {
    expect(dayLabel(at(11, 20, 0), now)).toBe("Today");
    // Eleven hours ago, but before midnight: yesterday.
    expect(dayLabel(at(11, 19, 23), new Date(at(11, 20, 1)))).toBe("Yesterday");
    expect(dayLabel(at(11, 19, 0), now)).toBe("Yesterday");
  });

  it("names an older day by weekday and date, with the year only when it isn't this one", () => {
    expect(dayLabel(at(11, 16), now)).toBe("Mon, Nov 16");
    expect(dayLabel(at(12, 31, 12, 2025), now)).toBe("Wed, Dec 31, 2025");
  });
});

describe("dayBreaks", () => {
  it("puts a divider only where consecutive lines change day, never before the first", () => {
    const times = [at(11, 16, 9), at(11, 16, 22), at(11, 19, 8), at(11, 20, 7), at(11, 20, 9)];
    expect(dayBreaks(times, now)).toEqual([undefined, undefined, "Yesterday", "Today", undefined]);
  });

  it("draws none for a conversation held within one day", () => {
    expect(dayBreaks([at(11, 20, 1), at(11, 20, 14)], now)).toEqual([undefined, undefined]);
  });

  it("lets a line with no time neither open a divider nor move the day", () => {
    expect(dayBreaks([at(11, 19), undefined, at(11, 19, 18), undefined, at(11, 20)], now)).toEqual([undefined, undefined, undefined, undefined, "Today"]);
  });
});

describe("lineTime", () => {
  it("reads a line's item time, a steps line's first step, and none for a stopped line", () => {
    const item = (ts: number) => ({ ts }) as never;
    expect(lineTime({ kind: "user", id: "u", requestId: "r", item: item(5) } as ItemLine)).toBe(5);
    expect(lineTime({ kind: "steps", id: "s", requestId: "r", items: [item(7), item(9)] } as ItemLine)).toBe(7);
    expect(lineTime({ kind: "stopped", id: "x", requestId: "r" })).toBeUndefined();
  });
});
