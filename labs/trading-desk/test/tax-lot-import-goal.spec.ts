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

// Two still-open AAPL lots. The FIRST is deliberately OLDER (2023) than the
// closed lot below, so the realized disposal is NOT the FIFO-oldest lot — this is
// what makes the test discriminate specific-lot derivation from FIFO.
const UNREALIZED_CSV = [
  "symbol,quantity,costBasis,unitCost,openDate",
  "AAPL,10,1000,100,2023-01-15",
  "AAPL,5,900,180,2025-06-20",
].join("\n");

// One CLOSED AAPL lot: bought 2024-03-01 (basis 2000 = 500/sh), sold 2025-08-01
// (proceeds 800) → a LONG-term LOSS of 1200. Under specific-lot matching the sell
// closes THIS lot (basis 2000). A pure-FIFO derivation would instead consume the
// older 2023 open lot (basis 100/sh → 400) and report a +400 GAIN, leaving a
// different set of lots open — so basis 2000 / gain -1200 / the open weighted
// basis all distinguish specific-lot from FIFO.
const REALIZED_CSV = [
  "symbol,quantity,costBasis,unitCost,openDate,closeDate,proceeds",
  "AAPL,4,2000,500,2024-03-01,2025-08-01,800",
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
    //    the two OPEN lots = (1000 + 900) / 15 ≈ 126.67. A FIFO derivation would
    //    instead leave 6@2023 + 4@2024 + 5@2025 open → a different weighted basis
    //    (≈ 233.33), so this basis alone distinguishes specific-lot from FIFO.
    const { holdings } = await repo.getPortfolio(USER);
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.quantity).toBe(15);
    expect(aapl?.costBasis).toBeCloseTo((1000 + 900) / 15); // ≈ 126.67, NOT FIFO's 233.33

    // 3. Realized gains match the realized file's OWN specific-lot figures — a
    //    single long-term disposal with basis 2000, proceeds 800, gain −1200. FIFO
    //    would have consumed the older 2023 open lot (basis 400) and reported a
    //    +400 gain, so basis 2000 / gain −1200 prove the specific lot was closed.
    const gains = await repo.getRealizedGains(USER);
    expect(gains).toHaveLength(1);
    const g = gains[0];
    expect(g.ticker).toBe("AAPL");
    expect(g.quantity).toBe(4);
    expect(g.costBasis).toBe(2000);
    expect(g.proceeds).toBe(800);
    expect(g.gain).toBe(-1200);
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
