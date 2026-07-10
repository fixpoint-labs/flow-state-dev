/**
 * Goal check — after refreshing prices once, the desk values the portfolio from
 * PERSISTED state without a second live fetch, and labels how old each price is
 * (FIX-823).
 *
 * This path has NO model: `getQuotes` upserts the durable `app.quotes` table, and
 * every consumer (the read route, the analysis seed's `buildPortfolioContext`)
 * values off that persisted state — never a re-fetch. The proof runs the REAL
 * production code — not mocks — by executing, by hand and outside the default
 * lane, the real-path specs that pin the contract over embedded PGlite (the real
 * dev DB engine):
 *
 *   - `portfolio-repository`   — `upsertQuotes` → `getQuotes` round-trip: a live
 *      price persists on the ticker PK, coerced to a JS number with an ISO as-of;
 *      a re-read returns it WITHOUT touching a provider.
 *   - `portfolio-actions`      — the `getQuotes` action upserts only live, non-null
 *      rows; a fixture-mode result is NOT persisted (no global-cache pollution);
 *      a provider miss keeps the prior last-known row.
 *   - `portfolio-quotes-route` — `GET /api/portfolio/quotes` returns the held
 *      tickers' persisted rows (the pane's read path), derived server-side.
 *   - `seed-portfolio-snapshot`— the analysis seed values NAV from the persisted
 *      `app.quotes` rows (no second fetch), scoped to the held tickers.
 *   - `value-holding`          — a quote-sourced price carries the quote's `asOf`
 *      (per-holding staleness); par / statement / unavailable are `asOf: null`.
 *
 * Run: pnpm tsx goals/trading-desk-portfolio/persist-last-known-price/run.mts
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const SPECS = [
  "portfolio-repository",
  "portfolio-actions",
  "portfolio-quotes-route",
  "seed-portfolio-snapshot",
  "value-holding",
];

try {
  execFileSync("pnpm", ["exec", "vitest", "run", ...SPECS], { stdio: "inherit", cwd: APP });
} catch {
  console.error("FAIL: a real-path persist-last-known-price spec did not pass.");
  process.exit(1);
}
console.log(
  "PASS: a refreshed price persists in app.quotes; the read route + analysis seed " +
    "value the portfolio from that persisted state without a second fetch, and per-" +
    "holding as-of staleness is threaded — all over real PGlite.",
);
process.exit(0);
