/**
 * The coding-run budget setting: `fsdev.config.mts` reads
 * `TEAMMATES_RUN_TIMEOUT_MS` through `runTimeout`, so a typo stops the lab at
 * start instead of handing every run a budget of `NaN`, zero, or one a timer
 * clamps to 1ms and so cancels every run at once.
 */
import { describe, expect, it } from "vitest";
import { runTimeout } from "../host.mts";

describe("runTimeout", () => {
  it("leaves the host's default in place when the setting is unset or blank", () => {
    expect(runTimeout(undefined)).toBeUndefined();
    expect(runTimeout(" ")).toBeUndefined();
  });

  it("reads a whole number of milliseconds", () => {
    expect(runTimeout("3600000")).toBe(3_600_000);
  });

  it("refuses anything a run could not be timed by, naming the setting", () => {
    for (const value of ["20m", "0", "-5", "1.5", "NaN", "2147483648"]) {
      expect(() => runTimeout(value)).toThrow(/TEAMMATES_RUN_TIMEOUT_MS must be a positive whole number/);
    }
  });
});
