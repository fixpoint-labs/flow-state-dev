/**
 * Unit tests for `loadFixture` — covers date-addressed path resolution, the
 * `source: "fixture"` stamp (with recorded `"unavailable"` preserved), date
 * validation before filesystem access, and the `FixtureMissingError` raised
 * on a missing fixture file.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadFixture } from "../flows/analysis/tools/runtime/fixtures";
import { FixtureMissingError } from "../flows/analysis/tools/schemas";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "fixtures");

describe("loadFixture", () => {
  it("loads NVDA balance sheet and stamps source", async () => {
    const result = await loadFixture(
      "get_balance_sheet",
      { ticker: "NVDA", date: "2026-05-06" },
      { rootDir: FIXTURE_ROOT },
    );
    expect(result.source).toBe("fixture");
    expect(result.ticker).toBe("NVDA");
    expect(result.totalAssets).toBeGreaterThan(0);
  });

  it("loads NVDA price history with a non-empty bars array", async () => {
    const result = await loadFixture(
      "get_price_history",
      { ticker: "NVDA", date: "2026-05-06" },
      { rootDir: FIXTURE_ROOT },
    );
    expect(result.source).toBe("fixture");
    expect(result.bars.length).toBeGreaterThan(5);
    expect(result.bars[0]).toHaveProperty("close");
  });

  it("loads macro indicators from the _macro sentinel directory", async () => {
    const result = await loadFixture(
      "get_macro_indicators",
      { date: "2026-05-06" },
      { rootDir: FIXTURE_ROOT },
    );
    expect(result.source).toBe("fixture");
    expect(result.cpiYoy).toBeTypeOf("number");
  });

  it("throws FixtureMissingError when the file does not exist", async () => {
    await expect(
      loadFixture(
        "get_balance_sheet",
        { ticker: "ZZZZ", date: "2026-05-06" },
        { rootDir: FIXTURE_ROOT },
      ),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });
});

describe("loadFixture date addressing", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "td-fixtures-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Write a hand-rolled fixture JSON under `{tmpRoot}/{ticker}/{date}/`. */
  function writeFixture(
    ticker: string,
    date: string,
    fileName: string,
    payload: Record<string, unknown>,
  ): void {
    const dir = path.join(tmpRoot, ticker, date);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, fileName), JSON.stringify(payload));
  }

  it("resolves the requested date's snapshot directory", async () => {
    writeFixture("NVDA", "2026-06-01", "balance-sheet.json", {
      source: "yahoo",
      ticker: "NVDA",
      totalAssets: 42,
    });
    const result = await loadFixture(
      "get_balance_sheet",
      { ticker: "NVDA", date: "2026-06-01" },
      { rootDir: tmpRoot },
    );
    expect(result.totalAssets).toBe(42);
  });

  it("throws FixtureMissingError carrying the requested date for an unknown date", async () => {
    const err = await loadFixture(
      "get_balance_sheet",
      { ticker: "NVDA", date: "2026-01-01" },
      { rootDir: tmpRoot },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FixtureMissingError);
    expect((err as FixtureMissingError).date).toBe("2026-01-01");
  });

  it("rejects a malformed date before touching the filesystem", async () => {
    // A traversal "date" that would resolve to a real file if it reached the
    // path join — the validator must throw first, never a FixtureMissingError.
    writeFixture("NVDA", "2026-05-06", "balance-sheet.json", {
      source: "yahoo",
      ticker: "NVDA",
    });
    for (const date of ["2026-6-1", "../etc", "../NVDA/2026-05-06"]) {
      const err = await loadFixture(
        "get_balance_sheet",
        { ticker: "NVDA", date },
        { rootDir: tmpRoot },
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(FixtureMissingError);
      expect((err as Error).message).toMatch(/YYYY-MM-DD/);
    }
  });

  it("preserves source: \"unavailable\"; rewrites provider tags to \"fixture\"", async () => {
    writeFixture("NVDA", "2026-06-01", "balance-sheet.json", {
      source: "unavailable",
      ticker: "NVDA",
    });
    writeFixture("NVDA", "2026-06-01", "fundamentals.json", {
      source: "yahoo",
      ticker: "NVDA",
    });
    const unavailable = await loadFixture(
      "get_balance_sheet",
      { ticker: "NVDA", date: "2026-06-01" },
      { rootDir: tmpRoot },
    );
    expect(unavailable.source).toBe("unavailable");
    const recorded = await loadFixture(
      "get_fundamentals",
      { ticker: "NVDA", date: "2026-06-01" },
      { rootDir: tmpRoot },
    );
    expect(recorded.source).toBe("fixture");
  });
});
