/**
 * Goal check — a mixed-asset brokerage statement imports as a complete, typed,
 * valued portfolio instead of an equity sliver (FIX-773).
 *
 * This path has NO model: the import is deterministic TS (`parsePortfolioCsv` →
 * `classifyInstrument`) persisted through the `app.holdings` repository over an
 * embedded PGlite (the real dev DB engine), then valued by `buildPortfolioContext`.
 * The proof therefore runs the REAL production code — not mocks — by executing the
 * real-path specs that pin the contract, by hand and outside the default lane:
 *
 *   - `holdings-taxonomy-repository` — a bond / option / cash_equivalent
 *     round-trip through `upsertHoldings` → `getPortfolio` over real PGlite, typed.
 *   - `build-portfolio-context` — a mixed book (equity via quote + bond at
 *     its carried mark + money-market at par + an unpriced bond) computes a NAV
 *     that INCLUDES the bond + money-market mass (the sliver the old importer lost).
 *   - `classify-instrument` — the symbol-shape taxonomy the importer keys on.
 *   - `portfolio-pdf` — the statement-parsing entry point.
 *
 * These specs are mock-free by construction (real PGlite, no model), which is
 * what makes delegating to them legitimate here — see `goals/lib/specs.mts`.
 *
 * Run: pnpm tsx goals/trading-desk-portfolio/multi-asset-import/run.mts
 */
import { TRADING_DESK, runGoal, runSpecs } from "../../lib/index.mts";

const SPECS = [
  "holdings-taxonomy-repository",
  "build-portfolio-context",
  "classify-instrument",
  "portfolio-pdf",
];

await runGoal(() => ({
  failures: runSpecs(TRADING_DESK, SPECS)
    ? []
    : ["a real-path import/valuation spec did not pass (see the vitest output above)"],
  evidence:
    "mixed-asset import persists typed bond / money-market / crypto / equity holdings " +
    `(none dropped) and NAV includes the non-equity mass — over real PGlite. Specs: ${SPECS.join(", ")}.`,
}));
