/**
 * Lot-identity field plumbing (FIX-895, step 1) — the two nullable lot-linkage
 * fields (`lotKey` / `closesLotKey`) added to the ledger event contract, and the
 * boundary rules that gate them.
 *
 * A tax-lot import carries lot identity on the ledger event so a specific-lot
 * disposal consumes its own paired lot (the specific-lot core landed in later
 * steps). This suite pins the FIELD-LEVEL contract this step owns:
 *   1. The zod refine's boundary rules (`lotKey` only on a share-adding event,
 *      `closesLotKey` only on a share-removing event, both null on cash/splits).
 *   2. The repository's shared `assertShareEventInvariant` enforcing the SAME
 *      rules on the file path (which bypasses zod), via `ingestLedgerEvents`.
 *   3. The lot-aware `computeFingerprint` — two content-identical keyed lots (and
 *      two same-date/qty sells of DIFFERENT lots) both land; unkeyed rows still
 *      dedup.
 *   4. The columns round-trip through the repository read boundary.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/db/client";
import { createPortfolioRepository, type PortfolioRepository } from "@/db/repository";
import {
  ledgerEventInputSchema,
  type LedgerEventInput,
} from "@/domain/portfolio/schema/ledger-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

/** A canonical buy, overridable — the lot fields default to null (unkeyed feed). */
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
    source: "file",
    externalId: null,
    description: null,
    basisUnknown: null,
    proceedsUnknown: null,
    lotKey: null,
    closesLotKey: null,
    ...overrides,
  };
}

describe("lot-identity zod boundary (refineLedgerEvent)", () => {
  it("accepts a lotKey on a share-adding buy", () => {
    expect(ledgerEventInputSchema.safeParse(ev({ lotKey: "taxlot:u:AAPL:2026-01-10:1" })).success).toBe(true);
  });

  it("rejects a lotKey on a share-removing sell", () => {
    const r = ledgerEventInputSchema.safeParse(
      ev({ type: "sell", quantity: -10, amount: 1500, lotKey: "taxlot:u:AAPL:2026-01-10:1" }),
    );
    expect(r.success).toBe(false);
  });

  it("accepts a closesLotKey on a share-removing sell", () => {
    const r = ledgerEventInputSchema.safeParse(
      ev({ type: "sell", quantity: -10, amount: 1500, closesLotKey: "taxlot:u:AAPL:2026-01-10:1" }),
    );
    expect(r.success).toBe(true);
  });

  it("rejects a closesLotKey on a share-adding buy", () => {
    expect(
      ledgerEventInputSchema.safeParse(ev({ closesLotKey: "taxlot:u:AAPL:2026-01-10:1" })).success,
    ).toBe(false);
  });

  it("rejects a lotKey on a cash dividend", () => {
    expect(
      ledgerEventInputSchema.safeParse(
        ev({ type: "dividend", quantity: null, unitPrice: null, amount: 5, lotKey: "x" }),
      ).success,
    ).toBe(false);
  });

  it("rejects a closesLotKey on a split", () => {
    expect(
      ledgerEventInputSchema.safeParse(
        ev({
          type: "split",
          quantity: null,
          unitPrice: null,
          amount: 0,
          attributes: { numerator: 2, denominator: 1 },
          closesLotKey: "x",
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts an unkeyed feed row (both null)", () => {
    expect(ledgerEventInputSchema.safeParse(ev()).success).toBe(true);
  });
});

describe("lot-identity ingest seam (assertShareEventInvariant + fingerprint + round-trip)", () => {
  let repo: PortfolioRepository;
  beforeEach(async () => {
    repo = createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
    await repo.upsertAccount({ id: "acc-1", userId: "u1", name: "Taxable", type: "taxable" });
  });

  it("rejects a lotKey on a sell at the shared seam (bypassing zod)", async () => {
    await expect(
      repo.ingestLedgerEvents([ev({ type: "sell", quantity: -10, amount: 1500, lotKey: "k" })], "u1"),
    ).rejects.toThrow(/lotKey/);
  });

  it("rejects a closesLotKey on a buy at the shared seam", async () => {
    await expect(
      repo.ingestLedgerEvents([ev({ closesLotKey: "k" })], "u1"),
    ).rejects.toThrow(/closesLotKey/);
  });

  it("both content-identical keyed lots land (distinct lotKey → distinct fingerprint)", async () => {
    const report = await repo.ingestLedgerEvents(
      [
        ev({ lotKey: "taxlot:u:AAPL:2026-01-10:1", externalId: "taxlot:u:AAPL:2026-01-10:1" }),
        ev({ lotKey: "taxlot:u:AAPL:2026-01-10:2", externalId: "taxlot:u:AAPL:2026-01-10:2" }),
      ],
      "u1",
    );
    expect(report.inserted).toBe(2);
    expect(await repo.getLedger("u1")).toHaveLength(2);
  });

  it("round-trips lotKey / closesLotKey through the read boundary", async () => {
    await repo.ingestLedgerEvents(
      [
        ev({ lotKey: "taxlot:r:AAPL:2026-01-10:2026-06-01:1", externalId: "buy" }),
        ev({
          type: "sell",
          quantity: -10,
          amount: 1500,
          closesLotKey: "taxlot:r:AAPL:2026-01-10:2026-06-01:1",
          externalId: "sell",
        }),
      ],
      "u1",
    );
    const rows = await repo.getLedger("u1");
    const buy = rows.find((r) => r.type === "buy");
    const sell = rows.find((r) => r.type === "sell");
    expect(buy?.lotKey).toBe("taxlot:r:AAPL:2026-01-10:2026-06-01:1");
    expect(buy?.closesLotKey).toBeNull();
    expect(sell?.lotKey).toBeNull();
    expect(sell?.closesLotKey).toBe("taxlot:r:AAPL:2026-01-10:2026-06-01:1");
  });

  it("unkeyed rows still dedup (both lot fields empty)", async () => {
    await repo.ingestLedgerEvents([ev()], "u1");
    const second = await repo.ingestLedgerEvents([ev()], "u1");
    expect(second.inserted).toBe(0);
    expect(second.deduplicated).toBe(1);
    expect(await repo.getLedger("u1")).toHaveLength(1);
  });
});
