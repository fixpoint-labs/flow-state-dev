/**
 * Unit tests for the record-mode fixture recorder. Covers:
 *   - `stableSerialize` — deterministic bytes regardless of key insertion
 *     order, array order preserved, 2-space indent, trailing newline
 *   - `recordFixture` — corpus path layout ({rootDir}/{ticker|_macro}/{date}/
 *     {fixtureFileName}), date + ticker path-segment validation before any
 *     write, zod-parsed payloads (unknown keys stripped, schema violations
 *     throw)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  recordFixture,
  stableSerialize,
} from "../flows/analysis/tools/runtime/recorder";

describe("stableSerialize", () => {
  it("produces identical bytes for identical logical objects with different key insertion orders", () => {
    const a = { b: 1, a: { z: true, y: [3, 1, 2] } };
    const insertedDifferently: Record<string, unknown> = {};
    insertedDifferently.a = { y: [3, 1, 2], z: true };
    insertedDifferently.b = 1;
    expect(stableSerialize(a)).toBe(stableSerialize(insertedDifferently));
  });

  it("preserves array order, uses 2-space indent, and ends with a newline", () => {
    const out = stableSerialize({ b: [2, 1], a: "x" });
    expect(out).toBe('{\n  "a": "x",\n  "b": [\n    2,\n    1\n  ]\n}\n');
  });

  it("sorts keys recursively, including objects nested inside arrays", () => {
    const out = stableSerialize({ items: [{ b: 1, a: 2 }] });
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"b"'));
  });
});

describe("recordFixture", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "td-recorder-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const balanceSheet = {
    source: "edgar" as const,
    ticker: "NVDA",
    asOf: "2026-06-01",
    totalAssets: 100,
    totalLiabilities: 40,
    totalEquity: 60,
    cashAndEquivalents: 20,
    totalDebt: 10,
    unit: "USD billions",
  };

  it("writes {rootDir}/{TICKER}/{DATE}/{fixtureFileName(tool)}", async () => {
    await recordFixture(
      "get_balance_sheet",
      { ticker: "NVDA", date: "2026-06-01" },
      balanceSheet,
      { rootDir: tmpRoot },
    );
    const filePath = path.join(tmpRoot, "NVDA", "2026-06-01", "balance-sheet.json");
    expect(existsSync(filePath)).toBe(true);
    const written = JSON.parse(readFileSync(filePath, "utf8"));
    expect(written.totalAssets).toBe(100);
    expect(written.source).toBe("edgar");
  });

  it("records a no-ticker payload under the _macro sentinel directory", async () => {
    const macro = {
      source: "fred" as const,
      asOf: "2026-06-01",
      cpiYoy: 2.5,
      unemployment: 4.1,
      fedFundsRate: 4.5,
      tenYearYield: 4.2,
      oilWtiUsd: 70,
      yieldCurve2s10s: 0.2,
      hyCreditSpread: 3.1,
      dollarIndex: 102,
      industrialProduction: 0.4,
    };
    await recordFixture(
      "get_macro_indicators",
      { date: "2026-06-01" },
      macro,
      { rootDir: tmpRoot },
    );
    expect(
      existsSync(path.join(tmpRoot, "_macro", "2026-06-01", "macro-indicators.json")),
    ).toBe(true);
  });

  it("throws on a malformed date before writing anything", async () => {
    await expect(
      recordFixture(
        "get_balance_sheet",
        { ticker: "NVDA", date: "../etc" },
        balanceSheet,
        { rootDir: tmpRoot },
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(existsSync(path.join(tmpRoot, "NVDA"))).toBe(false);
  });

  it("throws on a path-traversal ticker before writing anything", async () => {
    await expect(
      recordFixture(
        "get_balance_sheet",
        { ticker: "../NVDA", date: "2026-06-01" },
        balanceSheet,
        { rootDir: tmpRoot },
      ),
    ).rejects.toThrow(/Invalid fixture ticker/);
    expect(existsSync(path.join(tmpRoot, "NVDA"))).toBe(false);
    expect(existsSync(path.join(path.dirname(tmpRoot), "NVDA"))).toBe(false);
  });

  it("rejects a parent-segment ticker (`..`) that the character class allows", async () => {
    await expect(
      recordFixture(
        "get_balance_sheet",
        { ticker: "..", date: "2026-06-01" },
        balanceSheet,
        { rootDir: tmpRoot },
      ),
    ).rejects.toThrow(/Invalid fixture ticker/);
    // The traversal target — one level above the corpus root — must not exist.
    expect(existsSync(path.join(tmpRoot, "..", "2026-06-01"))).toBe(false);
  });

  it("writes the zod-parsed payload — unknown extra keys are stripped", async () => {
    await recordFixture(
      "get_balance_sheet",
      { ticker: "NVDA", date: "2026-06-01" },
      { ...balanceSheet, providerDebugBlob: "drop me" } as typeof balanceSheet,
      { rootDir: tmpRoot },
    );
    const written = JSON.parse(
      readFileSync(
        path.join(tmpRoot, "NVDA", "2026-06-01", "balance-sheet.json"),
        "utf8",
      ),
    );
    expect(written).not.toHaveProperty("providerDebugBlob");
  });

  it("throws when the payload violates the tool's output schema", async () => {
    await expect(
      recordFixture(
        "get_balance_sheet",
        { ticker: "NVDA", date: "2026-06-01" },
        { ...balanceSheet, totalAssets: "not-a-number" } as unknown as typeof balanceSheet,
        { rootDir: tmpRoot },
      ),
    ).rejects.toThrow();
  });

});
