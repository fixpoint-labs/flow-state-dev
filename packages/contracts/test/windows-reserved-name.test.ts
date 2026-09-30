import { describe, expect, it } from "vitest";
import { isWindowsReservedName } from "../src/helpers/windows-reserved-name";

/**
 * The list decides which names every store and loader refuses, so both
 * directions matter: a name missing from it produces something Windows cannot
 * open, and a name wrongly in it costs every caller a portable name.
 */
describe("isWindowsReservedName", () => {
  const DEVICES = [
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
  ];

  it.each(DEVICES)("reserves %s in lower, upper and mixed case", (name) => {
    expect(isWindowsReservedName(name)).toBe(true);
    expect(isWindowsReservedName(name.toUpperCase())).toBe(true);
    expect(isWindowsReservedName(name[0]!.toUpperCase() + name.slice(1))).toBe(true);
  });

  it.each(["com0", "lpt0", "com10", "lpt", "console", "con.md", ""])(
    "does not reserve %j — an ordinary name on Windows, or not a whole-name match",
    (name) => {
      expect(isWindowsReservedName(name)).toBe(false);
    },
  );
});
