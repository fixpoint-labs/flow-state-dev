/**
 * The lines the sidebar and Shift Coordinator derive for design v2's form: the
 * footer's initials and a message's clock time, each from what the Lab holds
 * and nothing else.
 */
import { describe, expect, it } from "vitest";
import { clockTime, initialsOf } from "../src/lib/shell";
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
