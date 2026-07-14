/**
 * Integration tests (embedded PGlite) for asset-class classification on the
 * ledger position-materialization path — the fix for QFX/transaction-sourced
 * portfolios, which never touch the CSV/PDF importer that used to be the only
 * place classification ran.
 *
 * Intent encoded:
 *   1. A holding materialized purely from transactions is classified by its
 *      ticker (a bond ETF lands `fixed_income`), NOT the `equity` column default.
 *   2. An existing auto-classified row SELF-HEALS on re-materialization — so a
 *      pre-fix `equity` row becomes `fixed_income` on the next import, with no
 *      re-add / delete.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/src/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/src/db/repository";
import type { LedgerEventInput } from "@/src/flows/portfolio/ledger-schema";
import type { CanonicalRow } from "@/src/flows/portfolio/portfolio-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  return createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
}

function buy(ticker: string, tradeDate = "2026-01-10"): LedgerEventInput {
  return {
    accountId: "acc-1",
    type: "buy",
    tradeDate,
    settleDate: null,
    ticker,
    quantity: 10,
    unitPrice: 100,
    amount: -1000,
    fee: null,
    currency: "USD",
    source: "manual",
    externalId: null,
    description: null,
    basisUnknown: null,
    proceedsUnknown: null,
  };
}

function equityRow(ticker: string): CanonicalRow {
  return {
    ticker,
    quantity: 10,
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

describe("materializePositions — asset-class classification", () => {
  it("classifies a bond ETF materialized from transactions as fixed_income / etf", async () => {
    await repo.ingestLedgerEvents([buy("TLT")], "devuser");
    const { holdings } = await repo.getPortfolio("devuser");
    const tlt = holdings.find((h) => h.ticker === "TLT");
    expect(tlt?.assetClass).toBe("fixed_income");
    expect(tlt?.assetType).toBe("etf");
  });

  it("leaves a plain equity ticker as equity", async () => {
    await repo.ingestLedgerEvents([buy("AAPL")], "devuser");
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.find((h) => h.ticker === "AAPL")?.assetClass).toBe("equity");
  });

  it("self-heals a pre-existing equity row to fixed_income on re-materialization", async () => {
    // Simulate a row materialized BEFORE the classifier knew TLT: stored equity.
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("TLT")], "upsert");
    expect(
      (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "TLT")?.assetClass,
    ).toBe("equity");

    // A new TLT transaction re-materializes the position → the conflict path
    // reclassifies the (non-manual) row.
    await repo.ingestLedgerEvents([buy("TLT")], "devuser");
    expect(
      (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "TLT")?.assetClass,
    ).toBe("fixed_income");
  });
});

describe("setHoldingAssetClass — manual override", () => {
  it("overrides the auto-classified class", async () => {
    await repo.ingestLedgerEvents([buy("AAPL")], "devuser");
    await repo.setHoldingAssetClass("acc-1", "devuser", "AAPL", "alternative");
    expect(
      (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "AAPL")?.assetClass,
    ).toBe("alternative");
  });

  it("survives re-materialization (a user override is never re-healed)", async () => {
    // TLT auto-classifies fixed_income; the user deliberately marks it equity.
    await repo.ingestLedgerEvents([buy("TLT")], "devuser");
    await repo.setHoldingAssetClass("acc-1", "devuser", "TLT", "equity");

    // A later TLT transaction re-materializes — the manual override must hold,
    // NOT snap back to the classifier's fixed_income.
    await repo.ingestLedgerEvents([buy("TLT", "2026-02-10")], "devuser");
    expect(
      (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "TLT")?.assetClass,
    ).toBe("equity");
  });

  it("does not touch another household's holding", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "intruder", name: "Other", type: "taxable" });
    await repo.ingestLedgerEvents([{ ...buy("MSFT"), accountId: "acc-2" }], "intruder");
    await expect(
      repo.setHoldingAssetClass("acc-2", "devuser", "MSFT", "alternative"),
    ).rejects.toThrow();
  });
});

describe("reclassifyHoldingByTicker — Yahoo-quoteType-driven auto-correction (FIX-762 follow-up)", () => {
  const etfClassification = {
    assetClass: "equity" as const,
    assetType: "etf" as const,
    attributes: { kind: "none" as const },
  };

  it("corrects a CSV/PDF-snapshot-only holding the ledger never re-materializes", async () => {
    // upsertHoldings (a snapshot import) is the path materializePositions'
    // self-heal doesn't cover — this method is specifically for that gap.
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("VOO")], "upsert");
    expect(
      (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "VOO")?.assetType,
    ).toBe("equity");

    await repo.reclassifyHoldingByTicker("devuser", "VOO", etfClassification);

    const voo = (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "VOO");
    expect(voo?.assetClass).toBe("equity");
    expect(voo?.assetType).toBe("etf");
  });

  it("updates every one of the user's accounts holding the ticker, not just one", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "devuser", name: "Roth", type: "Roth" });
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("VOO")], "upsert");
    await repo.upsertHoldings("acc-2", "devuser", [equityRow("VOO")], "upsert");

    const result = await repo.reclassifyHoldingByTicker("devuser", "VOO", etfClassification);
    expect(result.updated).toBe(2);

    const holdings = (await repo.getPortfolio("devuser")).holdings.filter((h) => h.ticker === "VOO");
    expect(holdings).toHaveLength(2);
    expect(holdings.every((h) => h.assetType === "etf")).toBe(true);
  });

  it("preserves a manual override (asset_class_manual) instead of overwriting it", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("VOO")], "upsert");
    await repo.setHoldingAssetClass("acc-1", "devuser", "VOO", "alternative");

    const result = await repo.reclassifyHoldingByTicker("devuser", "VOO", etfClassification);
    expect(result.updated).toBe(0);

    const voo = (await repo.getPortfolio("devuser")).holdings.find((h) => h.ticker === "VOO");
    // The manual override holds — an auto-correction never overwrites it.
    expect(voo?.assetClass).toBe("alternative");
    expect(voo?.assetType).toBe("equity");
  });

  it("does not touch another household's same-ticker holding", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "intruder", name: "Other", type: "taxable" });
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("VOO")], "upsert");
    await repo.upsertHoldings("acc-2", "intruder", [equityRow("VOO")], "upsert");

    await repo.reclassifyHoldingByTicker("devuser", "VOO", etfClassification);

    const intruderVoo = (await repo.getPortfolio("intruder")).holdings.find((h) => h.ticker === "VOO");
    expect(intruderVoo?.assetType).toBe("equity");
  });

  it("is a no-op when the user holds no such ticker", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [equityRow("AAPL")], "upsert");
    await expect(repo.reclassifyHoldingByTicker("devuser", "VOO", etfClassification)).resolves.toEqual({
      updated: 0,
    });
  });
});
