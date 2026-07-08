/**
 * Goal check — a mixed-asset brokerage statement imports as a complete, typed,
 * valued portfolio instead of an equity sliver (FIX-773).
 *
 * This path has NO model: the import is deterministic TS (`parsePortfolioCsv` →
 * `classifyInstrument`) persisted through the `app.holdings` repository over an
 * embedded PGlite (the real dev DB engine), then valued by `buildPortfolioContext`.
 * The proof therefore runs the REAL production code — not mocks — by executing the
 * two real-path specs that pin the contract, by hand and outside the default lane:
 *
 *   - `holdings-taxonomy-repository.spec.ts` — a bond / option / cash_equivalent
 *     round-trip through `upsertHoldings` → `getPortfolio` over real PGlite, typed.
 *   - `build-portfolio-context.spec.ts` — a mixed book (equity via quote + bond at
 *     its carried mark + money-market at par + an unpriced bond) computes a NAV
 *     that INCLUDES the bond + money-market mass (the sliver the old importer lost).
 *
 * Run: pnpm tsx goals/trading-desk-portfolio/multi-asset-import/run.mts
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const SPECS = [
  "holdings-taxonomy-repository",
  "build-portfolio-context",
  "classify-instrument",
  "portfolio-pdf",
];

try {
  execFileSync("pnpm", ["exec", "vitest", "run", ...SPECS], { stdio: "inherit", cwd: APP });
} catch {
  console.error("FAIL: a real-path import/valuation spec did not pass.");
  process.exit(1);
}
console.log(
  "PASS: mixed-asset import persists typed bond / money-market / crypto / equity " +
    "holdings (none dropped) and NAV includes the non-equity mass — over real PGlite.",
);
process.exit(0);
