/**
 * Goal check — the household portfolio-health view answers "how balanced is my
 * book?" deterministically across every account, and the same aggregates reach
 * the trader/PM context (FIX-762).
 *
 * This path has NO model: the household math is deterministic TS
 * (`summarizePortfolioHealth`) over the app-owned accounts + `app.quotes` +
 * `app.instrument_classifications` tables (real PGlite), computed identically in
 * the Health pane and at the analysis seed. The proof therefore runs the REAL
 * production code — not mocks — by executing, by hand and outside the default
 * lane, the specs that pin the contract end to end:
 *
 *   - `portfolio-health` — the leaf: ticker-merge across accounts, allocation vs
 *     exposure denominators, concentration metrics/flags, coverage honesty, and
 *     the pane-reconciliation case (leaf NAV == the pane rollup algorithm).
 *   - `instrument-classifications-repository` — the sector cache round-trip +
 *     upsert-on-conflict over real PGlite (misses never persisted).
 *   - `classifications-route` — the lazy fill route caches successes only.
 *   - `build-portfolio-context` — the compact `health` block projection + the
 *     `holdings[].sector` producer.
 *   - `format-portfolio-context` — the formatter renders the health block into
 *     `<portfolioContext>` (drift line only when a mandate read is present).
 *   - `seed-portfolio-snapshot` — `seedSession` reads the sector cache read-only
 *     and freezes the health block onto `state.portfolio` (the real seed wiring).
 *
 * Run: pnpm tsx goals/trading-desk-portfolio/household-health/run.mts
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const SPECS = [
  "portfolio-health",
  "instrument-classifications-repository",
  "classifications-route",
  "build-portfolio-context",
  "format-portfolio-context",
  "seed-portfolio-snapshot",
];

try {
  execFileSync("pnpm", ["exec", "vitest", "run", ...SPECS], { stdio: "inherit", cwd: APP });
} catch {
  console.error("FAIL: a real-path household-health spec did not pass.");
  process.exit(1);
}
console.log(
  "PASS: household health merges exposure across accounts, computes concentration/" +
    "sector/coverage deterministically, and injects the same compact aggregate into " +
    "the trader/PM <portfolioContext> — over real PGlite, no model.",
);
process.exit(0);
