/**
 * Tests for the manual ledger writer (`recordManualEvent`, FIX-774/FIX-874).
 *
 * Intent: a manually-entered sale is recorded with canonical proceeds. The
 * dialog takes a user-signed amount, and the FIX-874 share-event invariant
 * rejects a sell with negative proceeds — so the writer must canonicalize the
 * sell amount sign (the OFX importer's `Math.abs(total)` precedent) rather than
 * let a negative-amount sale silently fail to record.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/src/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/src/db/repository";
import { recordManualEvent, type RecordEventInput } from "@/src/flows/portfolio/portfolio-writes";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

function manual(over: Partial<RecordEventInput> = {}): RecordEventInput {
  return {
    accountId: "acc-1",
    type: "buy",
    tradeDate: "2026-01-10",
    settleDate: null,
    ticker: "AAPL",
    quantity: 10,
    unitPrice: 100,
    amount: -1000,
    fee: null,
    currency: "USD",
    description: null,
    basisUnknown: null,
    proceedsUnknown: null,
    ...over,
  };
}

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
  await repo.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
});

describe("recordManualEvent — sell proceeds sign", () => {
  it("canonicalizes a negative sell amount to positive proceeds (records, never silently fails)", async () => {
    await recordManualEvent(manual({ type: "buy", quantity: 10, unitPrice: 100, amount: -1000 }), "devuser", repo);
    // The sale entered with a NEGATIVE amount (the dialog's user-signed field).
    // Without canonicalization the FIX-874 invariant would throw and the row
    // would never land.
    const report = await recordManualEvent(
      manual({ type: "sell", quantity: -10, unitPrice: 150, amount: -1500, tradeDate: "2026-06-01" }),
      "devuser",
      repo,
    );
    expect(report.inserted).toBe(1);

    const soldRow = (await repo.getLedger("devuser")).find((r) => r.type === "sell");
    expect(soldRow?.amount).toBe(1500); // canonicalized to +proceeds, not −1500

    // And it derives a real gain (1500 − 1000 = 500), not an error or a loss off
    // fabricated negative proceeds.
    const gains = await repo.getRealizedGains("devuser");
    expect(gains).toHaveLength(1);
    expect(gains[0]).toMatchObject({ proceeds: 1500, costBasis: 1000, gain: 500 });
  });

  it("leaves a positive sell amount untouched", async () => {
    await recordManualEvent(manual({ type: "buy", quantity: 10, unitPrice: 100, amount: -1000 }), "devuser", repo);
    await recordManualEvent(
      manual({ type: "sell", quantity: -10, amount: 1500, tradeDate: "2026-06-01" }),
      "devuser",
      repo,
    );
    const soldRow = (await repo.getLedger("devuser")).find((r) => r.type === "sell");
    expect(soldRow?.amount).toBe(1500);
  });
});
