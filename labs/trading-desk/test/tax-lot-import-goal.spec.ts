/**
 * FIX-895 goal check (headless, service-layer — the spec's manual/visual goal
 * check, automated). A user imports paired unrealized + realized tax-lot CSVs
 * into a fresh account and sees:
 *   - open positions that match the unrealized file's lots, and
 *   - realized disposals whose basis / term / gain match the realized file's own
 *     specific-lot figures (NOT a FIFO re-derivation), and
 *   - a second identical import that dedups to zero.
 *
 * This drives the REAL path (`importTransactionFile` → `ingestLedgerEvents` →
 * `deriveLots` / `materializePositions` / `materializeRealizedGains`) against a
 * migrated PGlite DB — no browser, no mocks — so it proves the assembled feature,
 * not just the per-step units.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/db/client";
import { createPortfolioRepository, type PortfolioRepository } from "@/db/repository";
import { importTransactionFile } from "@/domain/portfolio/services/portfolio-writes";
import { seedAccount } from "./_helpers/portfolio-repo";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));
const USER = "u1";
const ACCT = "taxlot-acct";

// Two still-open AAPL lots (different acquisition dates + basis).
const UNREALIZED_CSV = [
  "symbol,quantity,costBasis,unitCost,openDate",
  "AAPL,10,1000,100,2025-01-15",
  "AAPL,5,900,180,2025-06-20",
].join("\n");

// One CLOSED AAPL lot: bought 2024-03-01 (basis 500), sold 2025-08-01
// (proceeds 800) — a long-term gain of 300. A separate lot from the open ones.
const REALIZED_CSV = [
  "symbol,quantity,costBasis,unitCost,openDate,closeDate,proceeds",
  "AAPL,4,500,125,2024-03-01,2025-08-01,800",
].join("\n");

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
  await seedAccount(repo, { accountId: ACCT, userId: USER, currency: "USD" });
});

async function importCsv(content: string): Promise<{ inserted: number; deduplicated: number }> {
  const report = await importTransactionFile(
    { accountId: ACCT, content, filename: "lots.csv", mode: "append" },
    USER,
    repo,
  );
  return { inserted: report.inserted, deduplicated: report.deduplicated };
}

describe("FIX-895 goal — paired tax-lot import reconstructs positions + realized gains", () => {
  it("derives open holdings from the unrealized file and realized gains from the realized file, then dedups", async () => {
    // 1. Import both files (append) into the fresh dedicated account.
    const unreal = await importCsv(UNREALIZED_CSV);
    expect(unreal.inserted).toBe(2); // two open-lot buys

    const real = await importCsv(REALIZED_CSV);
    expect(real.inserted).toBe(2); // the closed lot's buy + sell legs

    // 2. Open holdings match the unrealized file: 15 shares (the closed lot is
    //    fully disposed, so it is NOT an open position), weighted-average basis of
    //    the two open lots = (1000 + 900) / 15.
    const { holdings } = await repo.getPortfolio(USER);
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.quantity).toBe(15);
    expect(aapl?.costBasis).toBeCloseTo((1000 + 900) / 15); // ≈ 126.67 per share

    // 3. Realized gains match the realized file's OWN specific-lot figures — a
    //    single long-term disposal with basis 500, proceeds 800, gain 300. FIFO
    //    over the open lots would have reported a different (wrong) basis/term.
    const gains = await repo.getRealizedGains(USER);
    expect(gains).toHaveLength(1);
    const g = gains[0];
    expect(g.ticker).toBe("AAPL");
    expect(g.quantity).toBe(4);
    expect(g.costBasis).toBe(500);
    expect(g.proceeds).toBe(800);
    expect(g.gain).toBe(300);
    expect(g.term).toBe("long"); // 2024-03-01 → 2025-08-01 is > 1 year

    // 4. A second identical import of BOTH files dedups to zero — idempotent.
    const unrealAgain = await importCsv(UNREALIZED_CSV);
    const realAgain = await importCsv(REALIZED_CSV);
    expect(unrealAgain.inserted).toBe(0);
    expect(unrealAgain.deduplicated).toBe(2);
    expect(realAgain.inserted).toBe(0);
    expect(realAgain.deduplicated).toBe(2);

    // The derived state is unchanged after the re-import.
    const after = await repo.getPortfolio(USER);
    expect(after.holdings.find((h) => h.ticker === "AAPL")?.quantity).toBe(15);
    expect(await repo.getRealizedGains(USER)).toHaveLength(1);
  });
});
