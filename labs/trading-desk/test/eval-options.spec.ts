import { describe, expect, it } from "vitest";
import {
  EvalUsageError,
  parsePositiveNumberFlag,
} from "../eval/options";

describe("parsePositiveNumberFlag", () => {
  it("accepts omitted and positive finite values", () => {
    expect(parsePositiveNumberFlag(undefined, "max-cost-usd")).toBeUndefined();
    expect(parsePositiveNumberFlag("0.25", "max-cost-usd")).toBe(0.25);
    expect(parsePositiveNumberFlag("3", "k", { integer: true })).toBe(3);
  });

  it.each(["abc", "NaN", "Infinity", "0", "-1"])(
    "rejects invalid numeric value %s",
    (raw) => {
      expect(() => parsePositiveNumberFlag(raw, "max-cost-usd")).toThrow(EvalUsageError);
    },
  );

  it("rejects fractional values for count-like flags", () => {
    expect(() => parsePositiveNumberFlag("1.5", "k", { integer: true })).toThrow(
      "--k must be a positive integer",
    );
  });
});
