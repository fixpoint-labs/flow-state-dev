/**
 * One-time backfill: reclassify holdings that were mistyped
 * `assetType: "equity"` at import but are actually funds/crypto assets
 * (FIX-762 follow-up) — broad-market/sector/thematic ETFs and crypto trusts
 * whose ticker shape is indistinguishable from a real equity's, so the import
 * classifier had no way to catch them without an external signal. Yahoo has
 * no GICS sector for a fund (correctly), which is what left them permanently
 * stuck "Unclassified" in the Health view.
 *
 * Runs the SAME per-ticker logic as `GET /api/portfolio/classifications`
 * (`resolveSector` → `reconcileFundClassification` → cache/reclassify) —
 * deliberately SEQUENTIAL, unlike the route's `CLASSIFY_CONCURRENCY`-bounded
 * fan-out: Yahoo's free, unauthenticated endpoint tolerates a handful of
 * concurrent requests fine in normal page-load usage, but a first-time,
 * many-ticker backfill hitting it at once trips intermittent rate-limiting
 * (observed: a `CLASSIFY_CONCURRENCY: 4` pass left a handful of tickers
 * unresolved that every one of resolved individually on retry). This script
 * exists to converge in ONE unattended run, so it trades speed for
 * reliability; the live route keeps its bounded concurrency (interactive
 * page loads shouldn't serialize on Yahoo).
 *
 * Idempotent: a re-run against an already-reconciled book changes nothing — a
 * reclassified ticker is no longer `assetType: "equity"`, so it drops out of
 * the ticker set entirely, and an already-cached sector is never re-resolved.
 *
 *   pnpm --filter @flow-state-dev/trading-desk backfill-fund-classification
 *
 * Override the household with `BACKFILL_USER` (defaults to devuser, the
 * `nvda-split` precedent).
 */
import { getRepository } from "../lib/portfolio-db";
import { resolveSector } from "../src/flows/analysis/lib/sector-resolution";
import { reconcileFundClassification } from "../src/flows/portfolio/reconcile-fund-classification";

const USER_ID = process.env.BACKFILL_USER ?? "devuser";

const repo = await getRepository();
const { holdings } = await repo.getPortfolio(USER_ID);
const tickers = [
  ...new Set(holdings.filter((h) => h.assetType === "equity").map((h) => h.ticker.toUpperCase())),
];
console.log(`[backfill] ${tickers.length} assetType:"equity" tickers for "${USER_ID}"`);

const cached = await repo.getInstrumentClassifications(tickers);
const alreadyCached = new Set(cached.map((r) => r.ticker));
const misses = tickers.filter((t) => !alreadyCached.has(t));
console.log(`[backfill] ${misses.length} candidate(s) with no cached sector`);

const reclassified: string[] = [];
const newlyClassified: { ticker: string; sector: string }[] = [];
const date = new Date().toISOString().slice(0, 10);

for (const ticker of misses) {
  const { sector } = await resolveSector(ticker, date);
  if (sector !== null) {
    newlyClassified.push({ ticker, sector });
    console.log(`[backfill]   ${ticker}: sector=${sector}`);
    continue;
  }
  const correction = await reconcileFundClassification(ticker);
  if (correction === null) {
    console.log(`[backfill]   ${ticker}: no sector, no correction (unresolved — retried on a later request)`);
    continue;
  }
  await repo.reclassifyHoldingByTicker(USER_ID, ticker, correction);
  reclassified.push(ticker);
  console.log(`[backfill]   ${ticker}: equity → ${correction.assetClass}/${correction.assetType}`);
}

if (newlyClassified.length > 0) {
  await repo.upsertInstrumentClassifications(
    newlyClassified.map((r) => ({ ticker: r.ticker, sector: r.sector, source: "yahoo" })),
  );
}

console.log(
  `[backfill] done — ${reclassified.length} ticker(s) reclassified, ` +
    `${newlyClassified.length} resolved with a real sector, ` +
    `${misses.length - reclassified.length - newlyClassified.length} still unresolved.`,
);
// No process.exit(0) here: PGlite's embedded dev backend needs the event loop
// to drain to flush its writes to disk. An immediate process.exit() (the
// `nvda-split` script's own pattern) can race ahead of that flush, so a
// following invocation reads stale data. Let Node shut down naturally.
