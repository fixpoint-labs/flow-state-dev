/**
 * Integration tests for the ledger repository (FIX-774), on embedded PGlite —
 * the same engine the dev backing uses, no Docker (the `packages/store-postgres`
 * precedent the FIX-772 repository tests already follow).
 *
 * Intent encoded — these pin the shared ingestion contract FIX-775 (file import)
 * and FIX-853 (Plaid sync) bind to:
 *   1. Ingest is idempotent — re-running the same batch (or the same trade twice
 *      in one batch) inserts once; the rest are counted `deduplicated`.
 *   2. A same-source `external_id` retry is deduped by the partial unique index.
 *   3. Every ingest is household-scoped — a foreign account throws, writing
 *      nothing.
 *   4. Voiding tombstones rows (excluded from derivation) without deleting them.
 *   5. Basis is derived — ingesting buys recomputes the matching holding's
 *      cost basis + acquired date; a basis-unknown transfer-in writes null, not 0.
 *   6. `getLedger` reads newest-first, filters, and coerces numerics to numbers.
 *
 * Cross-SOURCE fingerprint collision (the same trade from two different feeds)
 * is exercised in FIX-775, the PR that introduces the second source.
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

function holding(ticker: string, quantity: number, costBasis: number | null = null): CanonicalRow {
  return { ticker, quantity, costBasis, acquiredDate: null };
}

function ev(overrides: Partial<LedgerEventInput> = {}): LedgerEventInput {
  return {
    accountId: "acc-1",
    type: "buy",
    tradeDate: "2026-01-10",
    settleDate: null,
    ticker: "AAPL",
    quantity: 10,
    unitPrice: 150,
    amount: -1500,
    fee: null,
    currency: "USD",
    source: "manual",
    externalId: null,
    description: null,
    basisUnknown: null,
    ...overrides,
  };
}

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = await freshRepo();
  await repo.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
});

describe("ingestLedgerEvents — idempotency", () => {
  it("inserts a batch once, then dedups an identical re-run", async () => {
    const batch = [ev({ ticker: "AAPL" }), ev({ ticker: "MSFT", amount: -900, unitPrice: 90 })];

    const first = await repo.ingestLedgerEvents(batch, "devuser");
    expect(first.inserted).toBe(2);
    expect(first.deduplicated).toBe(0);

    const second = await repo.ingestLedgerEvents(batch, "devuser");
    expect(second.inserted).toBe(0);
    expect(second.deduplicated).toBe(2);

    const ledger = await repo.getLedger("devuser");
    expect(ledger).toHaveLength(2); // not 4
  });

  it("dedups a duplicate within a single batch", async () => {
    const report = await repo.ingestLedgerEvents([ev(), ev()], "devuser");
    expect(report.inserted).toBe(1);
    expect(report.deduplicated).toBe(1);
    expect(await repo.getLedger("devuser")).toHaveLength(1);
  });

  it("dedups a same-source external-id retry", async () => {
    const a = ev({ externalId: "plaid-tx-1", source: "plaid", ticker: "NVDA", amount: -300 });
    // Same external id, different content — the (source, external_id) index still
    // catches it as the same logical transaction.
    const b = ev({ externalId: "plaid-tx-1", source: "plaid", ticker: "NVDA", amount: -999 });
    await repo.ingestLedgerEvents([a], "devuser");
    const report = await repo.ingestLedgerEvents([b], "devuser");
    expect(report.inserted).toBe(0);
    expect(report.deduplicated).toBe(1);
  });
});

describe("ingestLedgerEvents — household scoping", () => {
  it("throws and writes nothing when an event targets a foreign account", async () => {
    await expect(
      repo.ingestLedgerEvents([ev({ accountId: "acc-1" }), ev({ accountId: "not-mine" })], "devuser"),
    ).rejects.toThrow();
    expect(await repo.getLedger("devuser")).toHaveLength(0); // batch rolled back
  });

  it("rejects an ingest for an account owned by another user", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "other", name: "Theirs", type: "taxable" });
    await expect(repo.ingestLedgerEvents([ev({ accountId: "acc-2" })], "devuser")).rejects.toThrow();
  });
});

describe("voidLedgerEvents", () => {
  it("tombstones rows by (source, external_id) and excludes them from derivation", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 10)], "upsert");
    await repo.ingestLedgerEvents(
      [
        ev({ externalId: "plaid-1", source: "plaid", quantity: 10, unitPrice: 150, amount: -1500 }),
        ev({ externalId: "plaid-2", source: "plaid", quantity: 5, unitPrice: 160, amount: -800, tradeDate: "2026-02-01" }),
      ],
      "devuser",
    );

    const voided = await repo.voidLedgerEvents(["plaid-2"], "plaid", "devuser");
    expect(voided).toBe(1);

    const ledger = await repo.getLedger("devuser");
    const tomb = ledger.find((r) => r.externalId === "plaid-2");
    expect(tomb?.voidedAt).not.toBeNull(); // tombstoned, not deleted
    expect(ledger).toHaveLength(2);

    // Basis recomputed off the surviving buy only (10 @ 150).
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.find((h) => h.ticker === "AAPL")?.costBasis).toBe(150);
  });

  it("does not void another user's rows", async () => {
    await repo.ingestLedgerEvents([ev({ externalId: "plaid-1", source: "plaid" })], "devuser");
    expect(await repo.voidLedgerEvents(["plaid-1"], "plaid", "intruder")).toBe(0);
  });
});

describe("ingestLedgerEvents — derived basis", () => {
  it("recomputes a held ticker's cost basis and acquired date from buys", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 30)], "upsert");
    await repo.ingestLedgerEvents(
      [
        ev({ tradeDate: "2026-01-10", quantity: 10, unitPrice: 100, amount: -1000 }),
        ev({ tradeDate: "2026-03-10", quantity: 20, unitPrice: 220, amount: -4400 }),
      ],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.costBasis).toBeCloseTo((10 * 100 + 20 * 220) / 30); // 180
    expect(aapl?.acquiredDate).toBe("2026-01-10"); // earliest lot
    expect(typeof aapl?.costBasis).toBe("number"); // coerced, never a string
  });

  it("writes null cost (never 0) for a basis-unknown transfer-in", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [holding("TSLA", 5, 999)], "upsert");
    await repo.ingestLedgerEvents(
      [
        ev({
          type: "transfer",
          ticker: "TSLA",
          quantity: 5,
          unitPrice: null,
          amount: 0,
          basisUnknown: "transferred in; no acquisition record",
        }),
      ],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.find((h) => h.ticker === "TSLA")?.costBasis).toBeNull(); // not 0
  });

  it("leaves a holding with no ledger position untouched", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 10, 123)], "upsert");
    // Ingest a cash dividend only — no share-moving event for AAPL.
    await repo.ingestLedgerEvents(
      [ev({ type: "dividend", ticker: "AAPL", quantity: null, unitPrice: null, amount: 50 })],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.find((h) => h.ticker === "AAPL")?.costBasis).toBe(123); // unchanged
  });
});

describe("getLedger", () => {
  it("returns rows newest trade-date first, filters, and caps", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ ticker: "AAPL", tradeDate: "2026-01-01", amount: -100 }),
        ev({ ticker: "MSFT", tradeDate: "2026-03-01", amount: -200, unitPrice: 90 }),
        ev({ ticker: "AAPL", tradeDate: "2026-02-01", amount: -300, unitPrice: 140 }),
      ],
      "devuser",
    );

    const all = await repo.getLedger("devuser");
    expect(all.map((r) => r.tradeDate)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);

    const aapl = await repo.getLedger("devuser", { ticker: "AAPL" });
    expect(aapl.every((r) => r.ticker === "AAPL")).toBe(true);
    expect(aapl).toHaveLength(2);

    const capped = await repo.getLedger("devuser", { limit: 1 });
    expect(capped).toHaveLength(1);
    expect(capped[0].tradeDate).toBe("2026-03-01");
  });

  it("scopes the read to the household", async () => {
    await repo.ingestLedgerEvents([ev()], "devuser");
    expect(await repo.getLedger("intruder")).toHaveLength(0);
  });
});
