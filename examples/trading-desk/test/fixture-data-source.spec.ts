/**
 * Unit tests for `FixtureDataSource` — covers path resolution, the
 * `source: "fixture"` stamp, and the `FixtureMissingError` raised on a
 * missing fixture file.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { FixtureDataSource } from "../src/flows/trading-desk/blocks/tools/fixture-data-source";
import { FixtureMissingError } from "../src/flows/trading-desk/blocks/tools/data-source";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "fixtures");

describe("FixtureDataSource", () => {
  const ds = new FixtureDataSource({ rootDir: FIXTURE_ROOT });

  it("loads NVDA balance sheet and stamps source", async () => {
    const result = await ds.get_balance_sheet({ ticker: "NVDA", date: "2026-05-06" });
    expect(result.source).toBe("fixture");
    expect(result.ticker).toBe("NVDA");
    expect(result.totalAssets).toBeGreaterThan(0);
  });

  it("loads NVDA price history with a non-empty bars array", async () => {
    const result = await ds.get_price_history({
      ticker: "NVDA",
      date: "2026-05-06",
      range: "1mo",
    });
    expect(result.source).toBe("fixture");
    expect(result.bars.length).toBeGreaterThan(5);
    expect(result.bars[0]).toHaveProperty("close");
  });

  it("loads macro indicators from the _macro sentinel directory", async () => {
    const result = await ds.get_macro_indicators({ date: "2026-05-06" });
    expect(result.source).toBe("fixture");
    expect(result.cpiYoy).toBeTypeOf("number");
  });

  it("throws FixtureMissingError when the file does not exist", async () => {
    await expect(
      ds.get_balance_sheet({ ticker: "ZZZZ", date: "2026-05-06" }),
    ).rejects.toBeInstanceOf(FixtureMissingError);
  });
});
