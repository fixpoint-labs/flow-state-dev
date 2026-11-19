/**
 * The lines the sidebar and Shift Coordinator derive for design v2's form: the
 * footer's initials and a message's clock time, each from what the Lab holds
 * and nothing else.
 */
import { describe, expect, it } from "vitest";
import { clockTime, dayKey, dayLabel, initialsOf, withDayMarkers } from "../src/lib/shell";
import { isShiftCoordinatorWorking, startShiftCoordinatorWork } from "../src/lib/working";

describe("the footer's initials (v2:110)", () => {
  it("takes a letter from each of the first two words, dropping a one-letter prefix", () => {
    expect(initialsOf("u_devforce_lab")).toBe("DL");
    expect(initialsOf("mara.kim")).toBe("MK");
  });

  it("keeps a one-letter word that isn't a prefix, and reads a one-word id by its first two letters", () => {
    expect(initialsOf("u")).toBe("U");
    expect(initialsOf("mara")).toBe("MA");
  });

  it("never draws an empty square", () => {
    expect(initialsOf("__")).toBe("?");
  });
});

describe("a message's time (v2:135)", () => {
  it("is 24-hour HH:MM", () => {
    expect(clockTime(new Date(2026, 9, 2, 9, 5).getTime())).toBe("09:05");
    expect(clockTime(new Date(2026, 9, 2, 22, 41).getTime())).toBe("22:41");
  });
});

describe("the feed's day markers", () => {
  const NY = "America/New_York";
  // 23:30 and 00:30 New York time across the night of 18–19 Nov 2026 (UTC-5): one hour apart, two days.
  const lateNight = Date.UTC(2026, 10, 19, 4, 30);
  const earlyMorning = Date.UTC(2026, 10, 19, 5, 30);
  const morning = Date.UTC(2026, 10, 19, 13, 0);

  it("draws the day boundary at the user's midnight, not UTC's", () => {
    expect(dayKey(lateNight, NY)).toBe("2026-11-18");
    expect(dayKey(earlyMorning, NY)).toBe("2026-11-19");
    // In UTC both instants are the 19th: the boundary moves with the zone.
    expect(dayKey(lateNight, "UTC")).toBe(dayKey(earlyMorning, "UTC"));
  });

  it("puts a marker only where the feed crosses into a new day, between the two days' entries", () => {
    const entries = [lateNight - 3_600_000, lateNight, earlyMorning, morning];
    expect(withDayMarkers(entries, (ts) => ts, NY)).toEqual([
      lateNight - 3_600_000,
      lateNight,
      { kind: "day", day: "2026-11-19", at: earlyMorning },
      earlyMorning,
      morning,
    ]);
    expect(withDayMarkers([], (ts: number) => ts, NY)).toEqual([]);
  });

  it("labels the morning's marker Today, so a new day reads at a glance, and always shows the date", () => {
    expect(dayLabel(earlyMorning, morning, NY)).toBe("Today · Thu 19 Nov");
    expect(dayLabel(lateNight, morning, NY)).toBe("Yesterday · Wed 18 Nov");
    expect(dayLabel(Date.UTC(2026, 10, 10, 15), morning, NY)).toBe("Tue 10 Nov");
    expect(dayLabel(Date.UTC(2025, 11, 31, 15), morning, NY)).toBe("Wed 31 Dec 2025");
  });

  it("finds yesterday across a month boundary", () => {
    expect(dayLabel(Date.UTC(2026, 9, 31, 15), Date.UTC(2026, 10, 1, 15), NY)).toBe("Yesterday · Sat 31 Oct");
  });
});

describe("the Shift Coordinator's working state (v2:55, 168, 1424)", () => {
  it("stays lit until every line in flight has settled, so an early line can't clear a later one", () => {
    expect(isShiftCoordinatorWorking()).toBe(false);
    const first = startShiftCoordinatorWork();
    const second = startShiftCoordinatorWork();
    first();
    expect(isShiftCoordinatorWorking()).toBe(true);
    first();
    expect(isShiftCoordinatorWorking()).toBe(true);
    second();
    expect(isShiftCoordinatorWorking()).toBe(false);
  });
});
