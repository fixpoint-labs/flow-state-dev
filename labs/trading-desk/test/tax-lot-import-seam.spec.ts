/**
 * One-source-per-ticker seam + currency injection (FIX-895, step 5).
 *
 * The seam is the append-only structural rule this feature enforces (§0 D1 — no
 * whole-account dedication, no `replace` rebuild): within an `(account, ticker)`,
 * share-moving events are all tax-lot **keyed** or all feed **unkeyed**, never
 * mixed, in either import order. It binds every writer at the shared ingest seam
 * (`ingestLedgerEvents`), throws a typed `OneSourceConflictError` that rolls the
 * batch back, and surfaces as a rendered refusal report (file import) or a visible
 * throw (manual). This suite pins:
 *   1. The seam, both directions + in-batch + voided-then-reimport + idempotency.
 *   2. Currency injection (no file column → account currency) + the §0 D3 reject
 *      (file currency ≠ account currency → per-row skip).
 *   3. The file-import refusal report shape (0 inserts + conflict warning + guidance).
 *   4. The manual path surfacing the seam rejection as a visible error.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/db/client";
import {
  createPortfolioRepository,
  OneSourceConflictError,
  type PortfolioRepository,
} from "@/db/repository";
import type { LedgerEventInput } from "@/domain/portfolio/schema/ledger-schema";
import {
  importTransactionFile,
  recordManualEvent,
  type RecordEventInput,
} from "@/domain/portfolio/services/portfolio-writes";
import { seedAccount } from "./_helpers/portfolio-repo";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

const USER = "u1";
const ACCT = "acc-1";

/** A canonical AAPL buy; lot fields default null (unkeyed feed). */
function ev(over: Partial<LedgerEventInput> = {}): LedgerEventInput {
  return {
    accountId: ACCT,
    type: "buy",
    tradeDate: "2026-01-10",
    settleDate: null,
    ticker: "AAPL",
    quantity: 10,
    unitPrice: 150,
    amount: -1500,
    fee: null,
    currency: "USD",
    source: "file",
    externalId: null,
    description: null,
    basisUnknown: null,
    proceedsUnknown: null,
    lotKey: null,
    closesLotKey: null,
    ...over,
  };
}

/** A keyed (tax-lot) unrealized buy for AAPL. */
function keyedBuy(seq: number, over: Partial<LedgerEventInput> = {}): LedgerEventInput {
  const lotKey = `taxlot:u:AAPL:2026-01-10:${seq}`;
  return ev({ lotKey, externalId: lotKey, ...over });
}

/** An unrealized tax-lot CSV (lot-total basis), optionally with a currency column. */
function unrealizedCsv(currencyColumn?: string): string {
  const header = currencyColumn ? "symbol,quantity,costBasis,unitCost,openDate,currency" : "symbol,quantity,costBasis,unitCost,openDate";
  const row = currencyColumn ? `AAPL,10,1500,150,2026-01-10,${currencyColumn}` : "AAPL,10,1500,150,2026-01-10";
  return `${header}\n${row}`;
}

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
});

describe("one-source-per-ticker seam (repository ledger import)", () => {
  beforeEach(async () => {
    await repo.upsertAccount({ id: ACCT, userId: USER, name: "Taxable", type: "taxable" });
  });

  it("refuses a tax-lot (keyed) event onto unkeyed OFX history — and rolls back", async () => {
    await repo.ingestLedgerEvents([ev({ externalId: "ofx-1" })], USER); // unkeyed
    await expect(
      repo.ingestLedgerEvents([keyedBuy(1)], USER),
    ).rejects.toBeInstanceOf(OneSourceConflictError);
    expect(await repo.getLedger(USER)).toHaveLength(1); // batch rolled back
  });

  it("refuses an unkeyed (OFX/manual) share event onto keyed history — symmetric", async () => {
    await repo.ingestLedgerEvents([keyedBuy(1)], USER);
    await expect(
      repo.ingestLedgerEvents([ev({ externalId: "ofx-2" })], USER),
    ).rejects.toBeInstanceOf(OneSourceConflictError);
    expect(await repo.getLedger(USER)).toHaveLength(1);
  });

  it("names the offending ticker on the error", async () => {
    await repo.ingestLedgerEvents([ev({ externalId: "ofx-3" })], USER);
    await expect(repo.ingestLedgerEvents([keyedBuy(1)], USER)).rejects.toSatisfy(
      (e: unknown) => e instanceof OneSourceConflictError && e.tickers.includes("AAPL"),
    );
  });

  it("allows realized-after-unrealized into a clean account (both keyed — same kind)", async () => {
    await repo.ingestLedgerEvents([keyedBuy(1)], USER); // unrealized keyed buy
    // The paired realized import: a keyed acquisition leg + its keyed disposal.
    const lotKey = "taxlot:r:AAPL:2026-02-01:2026-06-01:1";
    const report = await repo.ingestLedgerEvents(
      [
        ev({ tradeDate: "2026-02-01", lotKey, externalId: lotKey }),
        ev({
          type: "sell",
          tradeDate: "2026-06-01",
          quantity: -10,
          amount: 1600,
          closesLotKey: lotKey,
          externalId: `${lotKey}#d`,
        }),
      ],
      USER,
    );
    expect(report.inserted).toBe(2);
  });

  it("rejects an in-batch group mixing keyed + unkeyed for an empty ticker", async () => {
    await expect(
      repo.ingestLedgerEvents([keyedBuy(1), ev({ externalId: "ofx-4" })], USER),
    ).rejects.toBeInstanceOf(OneSourceConflictError);
    expect(await repo.getLedger(USER)).toHaveLength(0);
  });

  it("allows a void-then-reimport of the opposite source (voided rows excluded)", async () => {
    await repo.ingestLedgerEvents([keyedBuy(1, { externalId: "keyed-1", source: "file" })], USER);
    // Void the keyed row; its tombstone keeps the linkage fields but must not block
    // switching the ticker to the unkeyed source.
    const voided = await repo.voidLedgerEvents(ACCT, ["keyed-1"], "file", USER);
    expect(voided).toBe(1);
    const report = await repo.ingestLedgerEvents([ev({ externalId: "ofx-5" })], USER);
    expect(report.inserted).toBe(1);
  });

  it("re-importing the same keyed lot is same-kind — no conflict, deduped", async () => {
    const first = await repo.ingestLedgerEvents([keyedBuy(1)], USER);
    expect(first.inserted).toBe(1);
    const second = await repo.ingestLedgerEvents([keyedBuy(1)], USER);
    expect(second.inserted).toBe(0);
    expect(second.deduplicated).toBe(1);
  });
});

describe("importTransactionFile — currency injection + D3 (§0 D3)", () => {
  it("injects the account currency onto a tax-lot row that carries no currency column", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER, currency: "EUR" });
    const out = await importTransactionFile(
      { accountId: ACCT, content: unrealizedCsv(), filename: "lots.csv", mode: "append" },
      USER,
      repo,
    );
    expect(out.inserted).toBe(1);
    const buy = (await repo.getLedger(USER)).find((r) => r.type === "buy");
    expect(buy?.currency).toBe("EUR"); // account currency, never the USD default
  });

  it("rejects a row whose file currency differs from the account (per-row skip)", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER, currency: "USD" });
    const out = await importTransactionFile(
      { accountId: ACCT, content: unrealizedCsv("EUR"), filename: "lots.csv", mode: "append" },
      USER,
      repo,
    );
    expect(out.inserted).toBe(0);
    expect(out.parseErrors.some((e) => /currency EUR does not match/i.test(e.reason))).toBe(true);
    expect(await repo.getLedger(USER)).toHaveLength(0);
  });

  it("keeps a matching file currency (no skip)", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER, currency: "USD" });
    const out = await importTransactionFile(
      { accountId: ACCT, content: unrealizedCsv("USD"), filename: "lots.csv", mode: "append" },
      USER,
      repo,
    );
    expect(out.inserted).toBe(1);
  });
});

describe("importTransactionFile — one-source refusal report", () => {
  it("returns a clean refusal report (0 inserts + conflict warning + fresh-account guidance)", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER });
    // Pre-existing unkeyed (OFX-style) AAPL history in the account.
    await repo.ingestLedgerEvents([ev({ source: "file", externalId: "ofx-existing" })], USER);

    const out = await importTransactionFile(
      { accountId: ACCT, content: unrealizedCsv(), filename: "lots.csv", mode: "append" },
      USER,
      repo,
    );
    expect(out.inserted).toBe(0);
    expect(out.deduplicated).toBe(0);
    expect(out.warnings.some((w) => /AAPL/.test(w) && /fresh|dedicated/i.test(w))).toBe(true);
    // The pre-existing OFX row is untouched — the whole tax-lot batch rolled back.
    expect(await repo.getLedger(USER)).toHaveLength(1);
  });
});

describe("recordManualEvent — surfaces the seam rejection", () => {
  it("throws OneSourceConflictError when an unkeyed manual share event lands on keyed history", async () => {
    await repo.upsertAccount({ id: ACCT, userId: USER, name: "Taxable", type: "taxable" });
    await repo.ingestLedgerEvents([keyedBuy(1)], USER);
    const manual: RecordEventInput = {
      accountId: ACCT,
      type: "buy",
      tradeDate: "2026-03-01",
      settleDate: null,
      ticker: "AAPL",
      quantity: 5,
      unitPrice: 160,
      amount: -800,
      fee: null,
      currency: "USD",
      description: null,
      basisUnknown: null,
      proceedsUnknown: null,
    };
    await expect(recordManualEvent(manual, USER, repo)).rejects.toBeInstanceOf(OneSourceConflictError);
  });
});
