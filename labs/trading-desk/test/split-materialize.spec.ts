/**
 * Integration tests (embedded PGlite) for the FIX-876 materialization changes:
 * the inconsistent-history GUARD and the split rebasing on the real repository
 * path (not just the pure `deriveLots` leaf).
 *
 * Intent encoded — the real-money invariant the whole issue exists to protect:
 *   1. An acquired ticker whose disposals exceed everything ever held (an
 *      unaccounted split) is materialized as a FLAGGED zero-quantity row
 *      (`dataQuality: "inconsistent_history"`), NEVER silently deleted.
 *   2. A clean net-zero close still DELETES its row (a genuine exit).
 *   3. A split rebases the derived position (correct quantity + basis).
 *   4. Recording the missing split SELF-HEALS the flagged row back to a real
 *      position with `dataQuality: null`.
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

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  return createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
}

function evt(over: Partial<LedgerEventInput> & { type: LedgerEventInput["type"] }): LedgerEventInput {
  return {
    accountId: "acc-1",
    tradeDate: "2024-01-01",
    settleDate: null,
    ticker: "NVDA",
    quantity: null,
    unitPrice: null,
    amount: 0,
    fee: null,
    currency: "USD",
    source: "manual",
    externalId: null,
    description: null,
    basisUnknown: null,
    attributes: null,
    ...over,
  };
}

const buy = (quantity: number, unitPrice: number, tradeDate: string): LedgerEventInput =>
  evt({ type: "buy", quantity, unitPrice, amount: -quantity * unitPrice, tradeDate });
const sell = (quantity: number, tradeDate: string): LedgerEventInput =>
  evt({ type: "sell", quantity: -quantity, amount: quantity * 100, tradeDate });
const splitEvt = (numerator: number, denominator: number, tradeDate: string): LedgerEventInput =>
  evt({ type: "split", tradeDate, attributes: { numerator, denominator } });

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = await freshRepo();
  await repo.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
});

async function nvda() {
  const { holdings } = await repo.getPortfolio("devuser");
  return holdings.find((h) => h.ticker === "NVDA");
}

describe("materializePositions — inconsistent-history guard (FIX-876)", () => {
  it("flags an over-sold acquired ticker instead of deleting it", async () => {
    // 12 pre-split shares, then a 50-share post-split sell (an unrecorded split):
    // FIFO over-sells → the position would net negative. It must NOT vanish.
    await repo.ingestLedgerEvents([buy(12, 900, "2024-01-01"), sell(50, "2024-07-31")], "devuser");
    const row = await nvda();
    expect(row).toBeDefined();
    expect(row?.quantity).toBe(0);
    expect(row?.dataQuality).toBe("inconsistent_history");
  });

  it("flags an oversold ticker even when a later buy leaves a residual position", async () => {
    // 12 pre-split shares, a 50-share post-split sale (over-sells), then a later
    // 60-share buy. FIFO clamps its way to a 60-share open position, but the
    // history is inconsistent (an unrecorded split) and that 60 is wrong — the
    // pre-split lots weren't rebased. It must flag, not show the fabricated number.
    await repo.ingestLedgerEvents(
      [buy(12, 900, "2024-01-01"), sell(50, "2024-07-31"), buy(60, 120, "2024-08-01")],
      "devuser",
    );
    const row = await nvda();
    expect(row?.quantity).toBe(0);
    expect(row?.dataQuality).toBe("inconsistent_history");
  });

  it("still DELETES a clean net-zero close (a genuine exit, not an inconsistency)", async () => {
    await repo.ingestLedgerEvents([buy(10, 100, "2024-01-01"), sell(10, "2024-02-01")], "devuser");
    expect(await nvda()).toBeUndefined();
  });

  it("materializes a split-rebased position with the correct quantity and basis", async () => {
    await repo.ingestLedgerEvents([buy(10, 900, "2024-01-01"), splitEvt(10, 1, "2024-06-10")], "devuser");
    const row = await nvda();
    expect(row?.quantity).toBe(100); // 10 × 10
    expect(row?.costBasis).toBe(90); // 900 ÷ 10
    expect(row?.dataQuality).toBeNull();
  });

  it("removes the flagged ghost row when the over-selling events are voided", async () => {
    // File-sourced buy+sell that over-sells → a flagged guard-created row (there
    // was no prior snapshot). Voiding both events (the user undoing a bad import)
    // must REMOVE the row entirely — not leave a stale 0-share ghost behind.
    await repo.ingestLedgerEvents(
      [
        { ...buy(12, 900, "2024-01-01"), source: "file", externalId: "F-BUY" },
        { ...sell(50, "2024-07-31"), source: "file", externalId: "F-SELL" },
      ],
      "devuser",
    );
    expect((await nvda())?.dataQuality).toBe("inconsistent_history");

    await repo.voidLedgerEvents("acc-1", ["F-BUY", "F-SELL"], "file", "devuser");
    expect(await nvda()).toBeUndefined(); // ghost deleted, not a 0-share leftover
  });

  it("preserves a real snapshot (not flagged) when its ledger events are voided", async () => {
    // A CSV/PDF snapshot for MSFT + a later file buy (materializes from the buy).
    // Voiding the buy returns MSFT to snapshot authority — the row is KEPT (basis
    // cleared), only guard-created flagged rows are deleted on void.
    await repo.upsertHoldings(
      "acc-1",
      "devuser",
      [
        {
          ticker: "MSFT",
          quantity: 5,
          costBasis: 100,
          acquiredDate: null,
          assetClass: "equity",
          assetType: "equity",
          attributes: { kind: "none" },
        },
      ],
      "upsert",
    );
    await repo.ingestLedgerEvents(
      [{ ...evt({ type: "buy", ticker: "MSFT", quantity: 5, unitPrice: 100, amount: -500 }), source: "file", externalId: "M9" }],
      "devuser",
    );
    await repo.voidLedgerEvents("acc-1", ["M9"], "file", "devuser");
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.some((h) => h.ticker === "MSFT")).toBe(true); // snapshot kept
  });

  it("self-heals a flagged row once the missing split is recorded", async () => {
    // Reproduce the flagged state...
    await repo.ingestLedgerEvents([buy(12, 900, "2024-01-01"), sell(50, "2024-07-31")], "devuser");
    expect((await nvda())?.dataQuality).toBe("inconsistent_history");

    // ...then record the split that explains the oversell.
    await repo.ingestLedgerEvents([splitEvt(10, 1, "2024-06-10")], "devuser");
    const healed = await nvda();
    expect(healed?.quantity).toBe(70); // 120 rebased − 50 sold
    expect(healed?.dataQuality).toBeNull();
  });

  it("clears a stale inconsistent-history flag when a fresh snapshot is imported for the ticker", async () => {
    // Reproduce the flagged state from an over-selling ledger...
    await repo.ingestLedgerEvents([buy(12, 900, "2024-01-01"), sell(50, "2024-07-31")], "devuser");
    expect((await nvda())?.dataQuality).toBe("inconsistent_history");

    // ...then the user imports a fresh CSV/PDF snapshot for the SAME ticker (a
    // new authoritative position). The snapshot upsert must clear the stale flag,
    // not keep blanking the freshly-imported numbers as "—".
    await repo.upsertHoldings(
      "acc-1",
      "devuser",
      [
        {
          ticker: "NVDA",
          quantity: 122,
          costBasis: 90,
          acquiredDate: null,
          assetClass: "equity",
          assetType: "equity",
          attributes: { kind: "none" },
        },
      ],
      "upsert",
    );
    const row = await nvda();
    expect(row?.quantity).toBe(122);
    expect(row?.dataQuality).toBeNull();
  });

  it("dedups a re-recorded same-date split (numerator/denominator excluded from the fingerprint)", async () => {
    await repo.ingestLedgerEvents([buy(10, 900, "2024-01-01")], "devuser");
    await repo.ingestLedgerEvents([splitEvt(10, 1, "2024-06-10")], "devuser");
    const second = await repo.ingestLedgerEvents([splitEvt(10, 1, "2024-06-10")], "devuser");
    expect(second.inserted).toBe(0);
    expect(second.deduplicated).toBe(1);
    // The split applied exactly once — not squared (×100).
    expect((await nvda())?.quantity).toBe(100);
  });
});

describe("replaceLedgerFromFile — reconciles holdings to the new source of truth (FIX-876)", () => {
  const msftBuy = (): LedgerEventInput =>
    evt({ type: "buy", ticker: "MSFT", quantity: 5, unitPrice: 200, amount: -1000, tradeDate: "2024-01-02" });

  it("drops a ledger-derived position the reset file no longer carries", async () => {
    await repo.ingestLedgerEvents([buy(10, 100, "2024-01-01"), msftBuy()], "devuser");
    const before = await repo.getPortfolio("devuser");
    expect(before.holdings.map((h) => h.ticker).sort()).toEqual(["MSFT", "NVDA"]);

    // Reset to a file that carries only NVDA — MSFT's materialized row must go
    // (its trade history was wiped and the new source doesn't back it).
    await repo.replaceLedgerFromFile("acc-1", "devuser", [buy(10, 100, "2024-01-01")]);
    const after = await repo.getPortfolio("devuser");
    expect(after.holdings.map((h) => h.ticker)).toEqual(["NVDA"]);
  });

  it("rejects events targeting a different account than the reset target", async () => {
    await repo.upsertAccount({ id: "acc-2", userId: "devuser", name: "Other", type: "taxable" });
    // Events for a DIFFERENT owned account must not wipe acc-1 and repopulate acc-2.
    await expect(
      repo.replaceLedgerFromFile("acc-1", "devuser", [
        { ...buy(1, 1, "2024-01-01"), accountId: "acc-2" },
      ]),
    ).rejects.toThrow();
  });

  it("does not orphan-delete a ticker whose ledger history is entirely voided", async () => {
    // MSFT: a snapshot holding + a ledger buy that is then voided (returning it to
    // snapshot authority). A reset that omits MSFT must NOT delete its row — voided
    // history has no live authority to drive an orphan delete.
    await repo.upsertHoldings(
      "acc-1",
      "devuser",
      [
        {
          ticker: "MSFT",
          quantity: 5,
          costBasis: 100,
          acquiredDate: null,
          assetClass: "equity",
          assetType: "equity",
          attributes: { kind: "none" },
        },
      ],
      "upsert",
    );
    await repo.ingestLedgerEvents(
      [{ ...msftBuy(), source: "file", externalId: "M1" }],
      "devuser",
    );
    await repo.voidLedgerEvents("acc-1", ["M1"], "file", "devuser");

    await repo.replaceLedgerFromFile("acc-1", "devuser", [buy(10, 100, "2024-01-01")]);
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.some((h) => h.ticker === "MSFT")).toBe(true); // snapshot survived
    expect(holdings.some((h) => h.ticker === "NVDA")).toBe(true);
  });

  it("orphan-deletes a ledger-derived ticker when the reset file only SELLS it (no new acquisition)", async () => {
    // Old ledger: a buy makes NVDA ledger-authoritative (materialized position).
    await repo.ingestLedgerEvents([buy(10, 100, "2024-01-01")], "devuser");
    expect(await nvda()).toBeDefined();

    // Reset file carries only a SELL for NVDA (no new buy) plus a real MSFT buy.
    // The reset must NOT leave NVDA's old materialized row as a stale position —
    // the new file doesn't re-establish it (a sell alone isn't an acquisition).
    await repo.replaceLedgerFromFile("acc-1", "devuser", [
      { ...sell(3, "2024-03-01") }, // NVDA sell, no acquisition
      msftBuy(),
    ]);
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.some((h) => h.ticker === "NVDA")).toBe(false); // not stale
    expect(holdings.some((h) => h.ticker === "MSFT")).toBe(true);
  });

  it("preserves a snapshot whose old ledger history was disposals-only (no acquisition)", async () => {
    // MSFT: a snapshot holding + a sell-only ledger history (a partial import that
    // `materializePositions` keeps as a snapshot, never a close). It has no
    // acquisition, so it never established ledger authority — a reset that omits it
    // must NOT orphan-delete the snapshot.
    await repo.upsertHoldings(
      "acc-1",
      "devuser",
      [
        {
          ticker: "MSFT",
          quantity: 5,
          costBasis: 100,
          acquiredDate: null,
          assetClass: "equity",
          assetType: "equity",
          attributes: { kind: "none" },
        },
      ],
      "upsert",
    );
    await repo.ingestLedgerEvents(
      [{ ...evt({ type: "sell", ticker: "MSFT", quantity: -2, amount: 200 }), tradeDate: "2024-03-01" }],
      "devuser",
    );

    await repo.replaceLedgerFromFile("acc-1", "devuser", [buy(10, 100, "2024-01-01")]);
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.some((h) => h.ticker === "MSFT")).toBe(true); // snapshot preserved
  });
});
