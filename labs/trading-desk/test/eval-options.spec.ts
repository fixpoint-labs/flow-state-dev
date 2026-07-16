import { describe, expect, it } from "vitest";
import {
  EvalUsageError,
  parsePositiveNumberFlag,
  resolveEvalDataDir,
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

  it("rejects a present numeric flag with no value", () => {
    expect(() =>
      parsePositiveNumberFlag(undefined, "max-cost-usd", { bare: true }),
    ).toThrow("--max-cost-usd requires a value");
  });
});

describe("resolveEvalDataDir", () => {
  const appDir = "/repo/labs/trading-desk";
  const outDir = "/tmp/eval-output";

  it("defaults sweeps to one isolated backing under the output directory", () => {
    expect(resolveEvalDataDir({ mode: "sweep", appDir, outDir })).toBe(
      "/tmp/eval-output/data",
    );
  });

  it.each(["eval", "variance"] as const)(
    "uses the shared application store for %s mode by default",
    (mode) => {
      expect(resolveEvalDataDir({ mode, appDir, outDir })).toBeUndefined();
    },
  );

  it("resolves an explicit relative data dir from the trading-desk directory", () => {
    expect(
      resolveEvalDataDir({
        mode: "variance",
        appDir,
        outDir,
        dataDir: ".fsdev/eval/data",
      }),
    ).toBe("/repo/labs/trading-desk/.fsdev/eval/data");
  });

  it("preserves an explicit absolute data dir", () => {
    expect(
      resolveEvalDataDir({
        mode: "eval",
        appDir,
        outDir,
        dataDir: "/tmp/existing-sweep",
      }),
    ).toBe("/tmp/existing-sweep");
  });
});
