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
import type { LedgerEventInput } from "@/src/domain/portfolio/schema/ledger-schema";
import { backfillSplits } from "@/src/domain/portfolio/services/portfolio-writes";
import type { CanonicalRow } from "@/src/domain/portfolio/schema/portfolio-schema";
import { estimateTaxLiability, summarizeForTaxEstimate } from "@/src/domain/portfolio/math/tax-estimate";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  return createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
}

function holding(ticker: string, quantity: number, costBasis: number | null = null): CanonicalRow {
  return {
    ticker,
    quantity,
    costBasis,
    acquiredDate: null,
    assetClass: "equity",
    assetType: "equity",
    attributes: { kind: "none" },
  };
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
    proceedsUnknown: null,
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

  it("keeps both rows when two accounts share a feed id in one batch", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "devuser", name: "IRA", type: "IRA" });
    // The same FITID is valid in two different accounts — the in-batch dedup key
    // is account-scoped (matching the DB index), so neither is dropped.
    const report = await repo.ingestLedgerEvents(
      [
        ev({ accountId: "acc-1", externalId: "FITID-1", source: "file" }),
        ev({ accountId: "acc-2", externalId: "FITID-1", source: "file" }),
      ],
      "devuser",
    );
    expect(report.inserted).toBe(2);
    expect(report.deduplicated).toBe(0);
    expect(await repo.getLedger("devuser")).toHaveLength(2);
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

  it("ingests a batch large enough to exceed the wire protocol's 16-bit param count", async () => {
    // The Postgres extended-protocol Bind message carries the bound-parameter
    // count as a 16-bit integer. At 17 params per ledger row, an unchunked
    // multi-row INSERT crosses 32,767 params at 1,928 rows — PGlite reads the
    // wrapped count as negative and dies with `RangeError: Invalid array
    // length`, wedging the (single) connection for every later query; node-pg
    // hits its own 65,535 ceiling at 3,856 rows. A year-scale brokerage OFX
    // backfill (FIX-775) is realistically thousands of rows, so the insert
    // must chunk. 2,500 rows crosses the PGlite boundary with margin.
    const batch = Array.from({ length: 2500 }, (_, i) =>
      ev({
        ticker: "AAPL",
        tradeDate: "2026-01-10",
        quantity: 1,
        unitPrice: 100 + i,
        amount: -(100 + i),
        externalId: `bulk-${i}`,
        source: "file",
      }),
    );

    const report = await repo.ingestLedgerEvents(batch, "devuser");
    expect(report.inserted).toBe(2500);
    expect(report.deduplicated).toBe(0);

    // The connection must survive the ingest — a follow-up read works.
    const rows = await repo.getLedger("devuser", { limit: 5 });
    expect(rows).toHaveLength(5);
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

describe("ingestLedgerEvents — share-event invariant", () => {
  it("rejects a sell with negative proceeds (would persist an overstated loss)", async () => {
    // The realized-gains path (FIX-874) uses `amount` as proceeds; a negative
    // sell amount would materialize negative proceeds. Guard it at ingest.
    await expect(
      repo.ingestLedgerEvents([ev({ type: "sell", quantity: -10, amount: -1300 })], "devuser"),
    ).rejects.toThrow(/non-negative proceeds/);
    expect(await repo.getLedger("devuser")).toHaveLength(0); // batch rolled back
  });

  it("still allows a genuine $0 sale", async () => {
    const r = await repo.ingestLedgerEvents(
      [ev({ type: "sell", quantity: -10, amount: 0 })],
      "devuser",
    );
    expect(r.inserted).toBe(1);
  });

  it("rejects a buy/sell with no quantity (would persist as a phantom cash event)", async () => {
    // A direct POST or a mis-mapping feed could send a share trade with null
    // quantity; deriveLots forms no lot, so positions + realized gains would
    // silently omit it. Reject at the shared boundary, not soft-skip.
    await expect(
      repo.ingestLedgerEvents([ev({ type: "buy", quantity: null, amount: -1500 })], "devuser"),
    ).rejects.toThrow(/must carry a share quantity/);
    await expect(
      repo.ingestLedgerEvents([ev({ type: "sell", quantity: null, amount: 1500 })], "devuser"),
    ).rejects.toThrow(/must carry a share quantity/);
    expect(await repo.getLedger("devuser")).toHaveLength(0); // both batches rolled back
  });
});

describe("upsertAccount — currency normalization", () => {
  it("stores a lowercase/mixed-case currency uppercased, matching normalized ledger rows", async () => {
    // The realized-gains total's exact currency check (FIX-874) compares the
    // account currency against uppercase-normalized ledger rows; persisting
    // `usd` verbatim would render an all-USD account's totals as `—`.
    await repo.upsertAccount({ id: "acc-lc", userId: "devuser", name: "Lower", type: "taxable", currency: "usd" });
    const accounts = await repo.getAccountsForUser("devuser");
    expect(accounts.find((a) => a.accountId === "acc-lc")?.currency).toBe("USD");
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

    const voided = await repo.voidLedgerEvents("acc-1", ["plaid-2"], "plaid", "devuser");
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
    expect(await repo.voidLedgerEvents("acc-1", ["plaid-1"], "plaid", "intruder")).toBe(0);
  });

  it("voids only the named account when two accounts share a feed id", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "devuser", name: "IRA", type: "IRA" });
    // The same FITID legitimately appears in two of the user's accounts.
    await repo.ingestLedgerEvents(
      [
        ev({ accountId: "acc-1", externalId: "FITID-1", source: "file" }),
        ev({ accountId: "acc-2", externalId: "FITID-1", source: "file" }),
      ],
      "devuser",
    );
    // Voiding acc-1's row must NOT tombstone acc-2's same-id row.
    expect(await repo.voidLedgerEvents("acc-1", ["FITID-1"], "file", "devuser")).toBe(1);

    const ledger = await repo.getLedger("devuser");
    const a1 = ledger.find((r) => r.accountId === "acc-1" && r.externalId === "FITID-1");
    const a2 = ledger.find((r) => r.accountId === "acc-2" && r.externalId === "FITID-1");
    expect(a1?.voidedAt).not.toBeNull();
    expect(a2?.voidedAt).toBeNull(); // untouched
  });

  it("clears derived basis when the last ledger row for a ticker is voided", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 10)], "upsert");
    await repo.ingestLedgerEvents(
      [ev({ externalId: "p1", source: "plaid", quantity: 10, unitPrice: 150, amount: -1500 })],
      "devuser",
    );
    // Basis derived from the buy.
    let portfolio = await repo.getPortfolio("devuser");
    expect(portfolio.holdings.find((h) => h.ticker === "AAPL")?.costBasis).toBe(150);

    // Void the only row → no derived position remains → basis is CLEARED, not stale.
    await repo.voidLedgerEvents("acc-1", ["p1"], "plaid", "devuser");
    portfolio = await repo.getPortfolio("devuser");
    const aapl = portfolio.holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.costBasis).toBeNull();
    expect(aapl?.acquiredDate).toBeNull();
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

  it("derives basis deterministically for a same-day buy+sell against an older lot in one batch", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 10)], "upsert");
    // One batch, all rows share created_at; the deterministic read order +
    // acquisitions-before-disposals same-day rule make the FIFO result stable:
    // the same-day sell consumes the OLD Jan lot, leaving the same-day Mar buy.
    await repo.ingestLedgerEvents(
      [
        ev({ tradeDate: "2026-01-01", quantity: 10, unitPrice: 10, amount: -100 }),
        ev({ tradeDate: "2026-03-01", quantity: 10, unitPrice: 200, amount: -2000 }),
        ev({ type: "sell", tradeDate: "2026-03-01", quantity: -10, amount: 2500 }),
      ],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.costBasis).toBe(200); // Mar lot remains; Jan lot was sold
    expect(aapl?.acquiredDate).toBe("2026-03-01");
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

describe("ingestLedgerEvents — position materialization (ledger wins)", () => {
  it("creates a holdings row from a transaction-only import (no prior holding)", async () => {
    // The FIX-775 first-import path: the user has NO snapshot — the ledger alone
    // must produce a visible active holding, or the Portfolio view stays empty.
    await repo.ingestLedgerEvents(
      [
        ev({ ticker: "NVDA", tradeDate: "2026-01-05", quantity: 4, unitPrice: 500, amount: -2000 }),
        ev({ ticker: "NVDA", tradeDate: "2026-02-05", quantity: 6, unitPrice: 600, amount: -3600 }),
      ],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    const nvda = holdings.find((h) => h.ticker === "NVDA");
    expect(nvda?.quantity).toBe(10);
    expect(nvda?.costBasis).toBeCloseTo((4 * 500 + 6 * 600) / 10); // 560
    expect(nvda?.acquiredDate).toBe("2026-01-05"); // hold period anchor
  });

  it("overwrites a disagreeing snapshot quantity with the ledger-derived position", async () => {
    // A CSV declared 100 shares, but the actual trade history says 25 — the
    // transaction record is ground truth, so the snapshot loses.
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 100, 50)], "upsert");
    await repo.ingestLedgerEvents(
      [ev({ tradeDate: "2026-01-10", quantity: 25, unitPrice: 200, amount: -5000 })],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.quantity).toBe(25);
    expect(aapl?.costBasis).toBe(200);
  });

  it("deletes the holdings row when the ledger position fully closes", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ tradeDate: "2026-01-10", quantity: 10, unitPrice: 100, amount: -1000 }),
        ev({ type: "sell", tradeDate: "2026-04-10", quantity: -10, unitPrice: 150, amount: 1500 }),
      ],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.find((h) => h.ticker === "AAPL")).toBeUndefined(); // closed — not active
    // The history is still in the ledger, not erased with the position.
    expect(await repo.getLedger("devuser", { ticker: "AAPL" })).toHaveLength(2);
  });

  it("keeps a snapshot holding (basis cleared) when a partial import has only a disposal", async () => {
    // A CSV snapshot declared 100 AAPL. The user imports an OFX range containing
    // only a SELL (the acquisition predates the range), so `deriveLots` clamps the
    // oversell to no open lot. This is an INCOMPLETE import, not a close — the
    // still-held position must NOT be deleted, or it vanishes until full history
    // is imported.
    await repo.upsertHoldings("acc-1", "devuser", [holding("AAPL", 100, 50)], "upsert");
    await repo.ingestLedgerEvents(
      [ev({ type: "sell", tradeDate: "2026-04-10", quantity: -10, unitPrice: 150, amount: 1500 })],
      "devuser",
    );
    const { holdings } = await repo.getPortfolio("devuser");
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl).toBeDefined(); // snapshot position preserved, not deleted
    expect(aapl?.quantity).toBe(100); // snapshot quantity untouched (ledger can't derive it)
    expect(aapl?.costBasis).toBeNull(); // derived basis cleared (acquisition not in range)
  });
});

describe("getIncomeSummary", () => {
  it("sums dividends and interest per (account, ticker), surviving a position close", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ ticker: "AAPL", tradeDate: "2026-01-10", quantity: 10, unitPrice: 100, amount: -1000 }),
        ev({ type: "dividend", ticker: "AAPL", tradeDate: "2026-02-01", quantity: null, unitPrice: null, amount: 25 }),
        ev({ type: "dividend", ticker: "AAPL", tradeDate: "2026-05-01", quantity: null, unitPrice: null, amount: 30 }),
        // Fully close the position AFTER the dividends were earned.
        ev({ type: "sell", ticker: "AAPL", tradeDate: "2026-06-01", quantity: -10, unitPrice: 150, amount: 1500 }),
        // Account-level interest with no security.
        ev({ type: "interest", ticker: null, tradeDate: "2026-03-01", quantity: null, unitPrice: null, amount: 5 }),
      ],
      "devuser",
    );
    const income = await repo.getIncomeSummary("devuser");

    const aapl = income.find((r) => r.ticker === "AAPL");
    expect(aapl?.dividends).toBe(55); // earned income outlives the closed position
    expect(aapl?.interest).toBe(0);
    expect(aapl?.lastEventDate).toBe("2026-05-01");

    const cash = income.find((r) => r.ticker === null);
    expect(cash?.interest).toBe(5);
    expect(cash?.dividends).toBe(0);
  });

  it("excludes voided income events and scopes to the household", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ type: "dividend", ticker: "MSFT", quantity: null, unitPrice: null, amount: 40, source: "file", externalId: "div-1" }),
        ev({ type: "dividend", ticker: "MSFT", tradeDate: "2026-02-10", quantity: null, unitPrice: null, amount: 60, source: "file", externalId: "div-2" }),
      ],
      "devuser",
    );
    await repo.voidLedgerEvents("acc-1", ["div-2"], "file", "devuser");

    const income = await repo.getIncomeSummary("devuser");
    expect(income.find((r) => r.ticker === "MSFT")?.dividends).toBe(40); // voided 60 excluded
    expect(await repo.getIncomeSummary("intruder")).toHaveLength(0);
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

describe("realized gains materialization (FIX-874) — real-path goal check", () => {
  // GOAL: current-year realized gains split ST/LT + a profile-driven estimate
  // that stays correct as sales are added and voided. Deterministic, no model —
  // the PGlite ingest→materialize→read→void→re-read path, plus the route-level
  // estimate composition over the real reads (taxable-account/USD filter).
  const sell = (over: Partial<LedgerEventInput>): LedgerEventInput =>
    ev({ type: "sell", quantity: -10, unitPrice: null, amount: 0, ...over });

  it("materializes ST/LT-split realized gains with correct totals, and retracts on void", async () => {
    await repo.ingestLedgerEvents(
      [
        // A long lot (2024) and a short lot (2026) of AAPL.
        ev({ ticker: "AAPL", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, amount: -1000 }),
        ev({ ticker: "AAPL", tradeDate: "2026-02-01", quantity: 10, unitPrice: 200, amount: -2000 }),
        // Sell 15 in 2026 for 4500 total → 10 long (proceeds 3000, gain 2000),
        // 5 short (proceeds 1500, gain 500).
        sell({
          ticker: "AAPL",
          tradeDate: "2026-06-01",
          quantity: -15,
          amount: 4500,
          source: "file",
          externalId: "SELL-1",
        }),
      ],
      "devuser",
    );

    const gains = await repo.getRealizedGains("devuser");
    expect(gains).toHaveLength(2);
    const long = gains.find((g) => g.term === "long");
    const short = gains.find((g) => g.term === "short");
    expect(long).toMatchObject({ proceeds: 3000, costBasis: 1000, gain: 2000 });
    expect(short).toMatchObject({ proceeds: 1500, costBasis: 1000, gain: 500 });

    // Void the sell → its realized rows retract.
    const voided = await repo.voidLedgerEvents("acc-1", ["SELL-1"], "file", "devuser");
    expect(voided).toBe(1);
    expect(await repo.getRealizedGains("devuser")).toHaveLength(0);
  });

  it("excludes IRA gains AND dividends from the composed estimate", async () => {
    await repo.upsertAccount({ id: "ira-1", userId: "devuser", name: "IRA", type: "IRA" });
    // Taxable: a realized long gain + a dividend. IRA: an equal gain + dividend.
    await repo.ingestLedgerEvents(
      [
        ev({ accountId: "acc-1", ticker: "AAPL", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, amount: -1000 }),
        sell({ accountId: "acc-1", ticker: "AAPL", tradeDate: "2026-06-01", quantity: -10, amount: 3000, source: "file", externalId: "TX-1" }),
        ev({ accountId: "acc-1", type: "dividend", ticker: "AAPL", tradeDate: "2026-03-01", quantity: null, unitPrice: null, amount: 100 }),
        ev({ accountId: "ira-1", ticker: "MSFT", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, amount: -1000 }),
        sell({ accountId: "ira-1", ticker: "MSFT", tradeDate: "2026-06-01", quantity: -10, amount: 3000, source: "file", externalId: "TX-2" }),
        ev({ accountId: "ira-1", type: "dividend", ticker: "MSFT", tradeDate: "2026-03-01", quantity: null, unitPrice: null, amount: 100 }),
      ],
      "devuser",
    );
    await repo.upsertTaxProfile("devuser", {
      filingStatus: "single",
      marginalOrdinaryRatePct: 24,
      ltcgRatePct: 15,
      stateRatePct: null,
    });

    // Compose the estimate the way the route does: taxable-account + USD filter.
    const accountsForUser = await repo.getAccountsForUser("devuser");
    const taxableIds = new Set(accountsForUser.filter((a) => a.type === "taxable").map((a) => a.accountId));
    const summary = summarizeForTaxEstimate({
      realized: await repo.getRealizedGains("devuser", {}),
      income: await repo.getIncomeSummaryByYear("devuser", {}),
      taxableAccountIds: taxableIds,
      year: 2026,
    });
    // Only the taxable account counts: 2000 long gain + 100 dividend, NOT double.
    expect(summary.longGains).toBe(2000);
    expect(summary.dividends).toBe(100);
    const estimate = estimateTaxLiability({
      profile: await repo.getTaxProfile("devuser"),
      year: 2026,
      ...summary,
    });
    // (2000 + 100) × 0.15 = 315 — the IRA's identical gain+dividend are excluded.
    expect(estimate.estimatedTotal).toBeCloseTo(315);
  });

  it("surfaces basis-unknown and unmatched disposals as null/unknown, not dropped or zeroed", async () => {
    await repo.ingestLedgerEvents(
      [
        // A transfer-in with no basis, later sold → gain null, term unknown.
        ev({ ticker: "TSLA", type: "transfer", tradeDate: "2026-01-01", quantity: 5, unitPrice: null, amount: 0, basisUnknown: "no acquisition record" }),
        sell({ ticker: "TSLA", tradeDate: "2026-06-01", quantity: -5, amount: 1000, source: "file", externalId: "S-TSLA" }),
        // An over-sell with no lot → unmatched remainder row.
        sell({ ticker: "NFLX", tradeDate: "2026-06-01", quantity: -3, amount: 900, source: "file", externalId: "S-NFLX" }),
      ],
      "devuser",
    );
    const gains = await repo.getRealizedGains("devuser");
    const tsla = gains.find((g) => g.ticker === "TSLA");
    const nflx = gains.find((g) => g.ticker === "NFLX");
    expect(tsla).toMatchObject({ gain: null, term: "unknown", proceeds: 1000 });
    expect(nflx).toMatchObject({ gain: null, term: "unknown", costBasis: null, proceeds: 900 });

    // Both are excluded from ST/LT buckets but surfaced in basisUnknown.
    const summary = summarizeForTaxEstimate({
      realized: gains,
      income: [],
      taxableAccountIds: new Set(["acc-1"]),
      year: 2026,
    });
    expect(summary.shortGains).toBe(0);
    expect(summary.longGains).toBe(0);
    expect(summary.basisUnknownCount).toBe(2);
    expect(summary.basisUnknownProceeds).toBe(1900);
  });

  it("does not duplicate realized rows on an idempotent re-ingest", async () => {
    const batch = [
      ev({ ticker: "AAPL", tradeDate: "2026-01-01", quantity: 10, unitPrice: 100, amount: -1000 }),
      sell({ ticker: "AAPL", tradeDate: "2026-06-01", quantity: -10, amount: 1500, source: "file", externalId: "R-1" }),
    ];
    await repo.ingestLedgerEvents(batch, "devuser");
    await repo.ingestLedgerEvents(batch, "devuser"); // re-run
    expect(await repo.getRealizedGains("devuser")).toHaveLength(1);
  });

  it("filters realized gains and income-by-year by year, and round-trips the tax profile", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ ticker: "AAPL", tradeDate: "2024-01-01", quantity: 20, unitPrice: 100, amount: -2000 }),
        sell({ ticker: "AAPL", tradeDate: "2025-06-01", quantity: -5, amount: 700, source: "file", externalId: "Y-25" }),
        sell({ ticker: "AAPL", tradeDate: "2026-06-01", quantity: -5, amount: 800, source: "file", externalId: "Y-26" }),
        ev({ type: "dividend", ticker: "AAPL", tradeDate: "2025-03-01", quantity: null, unitPrice: null, amount: 40 }),
        ev({ type: "dividend", ticker: "AAPL", tradeDate: "2026-03-01", quantity: null, unitPrice: null, amount: 60 }),
      ],
      "devuser",
    );
    expect(await repo.getRealizedGains("devuser", { year: 2025 })).toHaveLength(1);
    expect(await repo.getRealizedGains("devuser", { year: 2026 })).toHaveLength(1);
    const income2026 = await repo.getIncomeSummaryByYear("devuser", { year: 2026 });
    expect(income2026).toHaveLength(1);
    expect(income2026[0]).toMatchObject({ year: 2026, dividends: 60 });

    const saved = await repo.upsertTaxProfile("devuser", {
      filingStatus: "mfj",
      marginalOrdinaryRatePct: 22,
      ltcgRatePct: 15,
      stateRatePct: 5,
    });
    expect(saved).toMatchObject({ filingStatus: "mfj", marginalOrdinaryRatePct: 22, stateRatePct: 5 });
    const reread = await repo.getTaxProfile("devuser");
    expect(reread).toMatchObject({ filingStatus: "mfj", ltcgRatePct: 15, stateRatePct: 5 });
    // Upsert replaces in place.
    await repo.upsertTaxProfile("devuser", { filingStatus: "single", marginalOrdinaryRatePct: 32, ltcgRatePct: 20, stateRatePct: null });
    expect((await repo.getTaxProfile("devuser"))?.filingStatus).toBe("single");
  });

  it("backfillRealizedGains re-materializes from the ledger when the table is empty (dev rollout gap)", async () => {
    // Reproduces the dev-startup gap: sells live in the ledger but realized_gains
    // is empty (imported before the FIX-874 migration; dev has no deploy migrator
    // to run the backfill). Own db handle so we can clear the materialized table.
    const pglite = new PGlite();
    const db = await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
    const repo2 = createPortfolioRepository(db);
    await repo2.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
    await repo2.ingestLedgerEvents(
      [
        ev({ ticker: "AAPL", tradeDate: "2024-01-01", quantity: 10, unitPrice: 100, amount: -1000 }),
        sell({ ticker: "AAPL", tradeDate: "2026-06-01", quantity: -10, amount: 1500, source: "file", externalId: "R-1" }),
      ],
      "devuser",
    );
    // Ingest already materialized it; simulate the pre-migration state by clearing
    // the materialized table, leaving the sell in the ledger.
    expect(await repo2.getRealizedGains("devuser")).toHaveLength(1);
    await pglite.query("DELETE FROM app.realized_gains");
    expect(await repo2.getRealizedGains("devuser")).toHaveLength(0);

    // The backfill (wired into dev startup in lib/portfolio-db.ts) re-derives it.
    await repo2.backfillRealizedGains();
    const gains = await repo2.getRealizedGains("devuser");
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({ ticker: "AAPL", proceeds: 1500, costBasis: 1000, gain: 500, term: "long" });
    // This test builds + migrates its OWN PGlite (it needs a raw handle to clear
    // realized_gains), on top of the suite beforeEach's — so an explicit timeout,
    // not Vitest's 5s default, keeps a slow CI runner from failing it before it
    // verifies the backfill.
  }, 30_000);

  it("chunks the realized-gains insert so a large sell history can't corrupt the connection (FIX-874 dev-DB break)", async () => {
    // 2,200 one-share lots closed by a single sell → 2,200 realized rows. At 15
    // bound params/row that is 33,000 params, over PGlite's 32,767 (signed
    // 16-bit) per-INSERT ceiling. An UNCHUNKED insert silently desyncs the wire
    // protocol: it throws nothing, but every later query on the shared dev
    // connection returns empty — reads go blank and writes fail. Because
    // `backfillRealizedGains` runs this materializer on every dev boot, one
    // active account bricked the entire app. The read-backs below only survive
    // if `materializeRealizedGains` chunks the insert.
    const LOTS = 2200;
    const base = new Date("2015-01-01T00:00:00Z").getTime();
    const isoDay = (i: number) => new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    const buys = Array.from({ length: LOTS }, (_, i) =>
      ev({
        ticker: "AAPL",
        tradeDate: isoDay(i),
        quantity: 1,
        unitPrice: 10,
        amount: -10,
        source: "file",
        externalId: `B-${i}`,
      }),
    );
    const closeAll = sell({
      ticker: "AAPL",
      tradeDate: "2026-06-01",
      quantity: -LOTS,
      amount: LOTS * 20,
      source: "file",
      externalId: "S-1",
    });
    await repo.ingestLedgerEvents([...buys, closeAll], "devuser");

    // The connection must still serve BOTH the materialized rows and an
    // unrelated read — both come back empty if the oversized insert corrupted it.
    expect(await repo.getRealizedGains("devuser")).toHaveLength(LOTS);
    expect(await repo.getAccountsForUser("devuser")).toHaveLength(1);
  });
});

describe("backfillSplits (FIX-874 follow-up) — provider split backfill", () => {
  it("corrects a split-mangled realized gain by backfilling the split from the provider", async () => {
    // The NVDA scenario: buy 10 @ $1,200, then a 10:1 split the import missed, then
    // sell all 100 @ $120. Without the split the ledger over-sells (10 held, 100
    // sold). Backfilling the split makes realized gain ≈ $0.
    await repo.ingestLedgerEvents(
      [
        ev({ ticker: "NVDA", tradeDate: "2024-01-02", quantity: 10, unitPrice: 1200, amount: -12000, source: "file", externalId: "B-NVDA" }),
        ev({ type: "sell", ticker: "NVDA", tradeDate: "2024-07-01", quantity: -100, unitPrice: null, amount: 12000, source: "file", externalId: "S-NVDA" }),
      ],
      "devuser",
    );
    // Before backfill: the over-sell means an unaccounted split, so every derived
    // gain is NULLED (excluded from the tax estimate) rather than surfacing a
    // ~-$10,800 phantom loss off mismatched pre/post-split units.
    const before = await repo.getRealizedGains("devuser");
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.gain === null)).toBe(true);

    const stub = async (ticker: string) =>
      ticker === "NVDA" ? [{ date: "2024-06-10", numerator: 10, denominator: 1 }] : [];
    const report = await backfillSplits("devuser", repo, stub, "2024-12-31");
    expect(report.inserted).toBe(1); // one split event written for the account
    expect(report.splitsFound).toBe(1);

    // After backfill: the split re-derives realized gains to ≈ $0, no basis-unknown.
    const after = await repo.getRealizedGains("devuser");
    const afterGain = after.reduce((s, r) => s + (r.gain ?? 0), 0);
    expect(afterGain).toBeCloseTo(0, 4);
    expect(after.every((r) => r.gain !== null)).toBe(true);
  });

  it("is idempotent — a second backfill inserts nothing", async () => {
    await repo.ingestLedgerEvents(
      [ev({ ticker: "NVDA", tradeDate: "2024-01-02", quantity: 10, unitPrice: 1200, amount: -12000, source: "file", externalId: "B2" })],
      "devuser",
    );
    const stub = async () => [{ date: "2024-06-10", numerator: 10, denominator: 1 }];
    const first = await backfillSplits("devuser", repo, stub, "2024-12-31");
    expect(first.inserted).toBe(1);
    const second = await backfillSplits("devuser", repo, stub, "2024-12-31");
    expect(second.inserted).toBe(0);
    expect(second.deduplicated).toBe(1);
  });

  it("collects a per-ticker provider failure without aborting the rest", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ ticker: "NVDA", tradeDate: "2024-01-02", quantity: 10, unitPrice: 1200, amount: -12000, source: "file", externalId: "B3" }),
        ev({ ticker: "AAPL", tradeDate: "2024-01-02", quantity: 10, unitPrice: 100, amount: -1000, source: "file", externalId: "B4" }),
      ],
      "devuser",
    );
    const stub = async (ticker: string) => {
      if (ticker === "AAPL") throw new Error("provider 503");
      return [{ date: "2024-06-10", numerator: 10, denominator: 1 }];
    };
    const report = await backfillSplits("devuser", repo, stub, "2024-12-31");
    expect(report.inserted).toBe(1); // NVDA split still written
    expect(report.errors).toEqual([{ ticker: "AAPL", reason: "provider 503" }]);
  });
});
