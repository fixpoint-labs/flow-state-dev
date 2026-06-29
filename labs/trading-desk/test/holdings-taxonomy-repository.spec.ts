/**
 * Repository round-trip tests for the holdings asset taxonomy (FIX-773 Slice A).
 *
 * Intent encoded — these pin the persistence contract the later importer /
 * valuation slices depend on:
 *   1. A pre-taxonomy equity holding reads back as `equity` / `equity` /
 *      `{ kind: "none" }` — the regression that the JSONB column default is
 *      `{"kind":"none"}`, NOT `{}` (a `{}` has no `kind` discriminator and would
 *      throw when `mapHolding` parses it).
 *   2. A bond, an option, and a cash_equivalent round-trip through
 *      `upsertHoldings` and read back TYPED via `getPortfolio`.
 *   3. An `upsert` that re-classifies an existing ticker overwrites
 *      `assetType` — the load-bearing `excluded.*` set-clause additions, without
 *      which a re-classified ticker silently keeps its old type.
 *
 * Runs on embedded PGlite (the `portfolio-repository.spec.ts` harness).
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/src/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/src/db/repository";
import type { CanonicalRow } from "@/src/flows/portfolio/portfolio-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  return createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
}

/** An equity row with the Slice-A defaults — the shape the importers emit. */
function equityRow(ticker: string, quantity: number): CanonicalRow {
  return {
    ticker,
    quantity,
    costBasis: null,
    acquiredDate: null,
    assetClass: "equity",
    assetType: "equity",
    attributes: { kind: "none" },
  };
}

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = await freshRepo();
  await repo.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
});

describe("holdings taxonomy — migration default", () => {
  it("reads a backfilled equity holding as equity/equity/{kind:'none'} (not {})", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("AAPL", 10)], "upsert");
    const { holdings } = await repo.getPortfolio("devuser");
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.assetClass).toBe("equity");
    expect(aapl?.assetType).toBe("equity");
    expect(aapl?.attributes).toEqual({ kind: "none" });
  });
});

describe("holdings taxonomy — non-equity round-trip", () => {
  it("round-trips a bond, an option, and a cash_equivalent typed", async () => {
    const bond: CanonicalRow = {
      ticker: "T912828YK0",
      quantity: 10,
      costBasis: 98.5,
      acquiredDate: null,
      assetClass: "fixed_income",
      assetType: "bond",
      attributes: { kind: "bond", cusip: "912828YK0", coupon: null, maturity: null, yield: null },
    };
    const option: CanonicalRow = {
      ticker: "AAPL_C200",
      quantity: 2,
      costBasis: 5.2,
      acquiredDate: null,
      assetClass: "equity",
      assetType: "option",
      attributes: {
        kind: "option",
        underlying: "AAPL",
        strike: 200,
        expiry: "2026-12-18",
        right: "call",
        multiplier: 100,
      },
    };
    const cash: CanonicalRow = {
      ticker: "VMFXX",
      quantity: 1000,
      costBasis: 1,
      acquiredDate: null,
      assetClass: "cash",
      assetType: "money_market",
      attributes: { kind: "cash_equivalent", yield: 5.1 },
    };

    await repo.upsertHoldings("acc-1", "devuser", [bond, option, cash], "upsert");
    const { holdings } = await repo.getPortfolio("devuser");
    const byTicker = Object.fromEntries(holdings.map((h) => [h.ticker, h]));

    expect(byTicker.T912828YK0.assetClass).toBe("fixed_income");
    expect(byTicker.T912828YK0.assetType).toBe("bond");
    expect(byTicker.T912828YK0.attributes).toEqual({
      kind: "bond",
      cusip: "912828YK0",
      coupon: null,
      maturity: null,
      yield: null,
    });

    expect(byTicker.AAPL_C200.assetType).toBe("option");
    expect(byTicker.AAPL_C200.attributes).toEqual(option.attributes);

    expect(byTicker.VMFXX.assetClass).toBe("cash");
    expect(byTicker.VMFXX.attributes).toEqual({ kind: "cash_equivalent", yield: 5.1 });
  });
});

describe("holdings taxonomy — re-classification (set-clause)", () => {
  it("an upsert that re-classifies an existing ticker updates assetType (and class)", async () => {
    // First seen as a plain equity.
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("QQQ", 5)], "upsert");

    // Re-imported, now correctly classified as an ETF. Without the
    // `excluded.asset_class/type/attributes` entries in the ON CONFLICT set
    // clause, the in-place update would silently keep the stale `equity` type.
    const reclassified: CanonicalRow = {
      ticker: "QQQ",
      quantity: 5,
      costBasis: null,
      acquiredDate: null,
      assetClass: "equity",
      assetType: "etf",
      attributes: { kind: "none" },
    };
    await repo.upsertHoldings("acc-1", "devuser", [reclassified], "upsert");

    const { holdings } = await repo.getPortfolio("devuser");
    const qqq = holdings.find((h) => h.ticker === "QQQ");
    expect(qqq?.assetType).toBe("etf"); // updated, not the stale "equity"
  });
});
