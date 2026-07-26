/**
 * Build the `portfolioContextInput` snapshot the `analyze` action dispatches,
 * from the Slice-4 stored accounts + the durable last-known `app.quotes` table
 * (FIX-823; read via the repository at seed).
 *
 * THE LOAD-BEARING INTEGRATION (BUILD_PLAN portfolio-shape alignment). Slice 4
 * stores `quantity` / `costBasis` per holding but NOT market value, weight, NAV,
 * or sector. Weights are computed once at seed; the flow never recomputes. So
 * this pure, browser-safe function (called server-side in `seedSession`,
 * `orchestration/guards.ts`) computes the snapshot:
 *   - per-holding `marketValue` = quantity × the TYPE-RESOLVED price
 *     (`value-holding.ts`, FIX-773 Slice C): equity via live quote, a bond/option
 *     at its carried statement mark, MMF/cash at par — null when none resolves
 *   - `totalNav` = Σ(known marketValue) + Σ(account.cashBalance)
 *   - per-holding `weightPct` = marketValue / totalNav × 100 (null when either
 *     the price or the NAV is unknown)
 *
 * REAL-MONEY DISCIPLINE (non-negotiable):
 *   - A ticker with no live quote degrades to `marketValue: null` /
 *     `weightPct: null`. We NEVER fabricate a price (real-money gate §1).
 *   - `totalNav` counts only KNOWN market values + cash; unpriced holdings add
 *     nothing (they do not silently inflate or deflate NAV).
 *   - `snapshotAsOf` carries the quotes' as-of so the PM/UI label staleness
 *     (RISK-P3) — a frozen snapshot is never presented as live.
 *   - `pricedHoldings` / `totalHoldings` let the prompt + UI state coverage
 *     honestly instead of pretending every holding is priced.
 *
 * Returns `null` when there are no accounts at all (portfolio-blind run). An
 * empty portfolio with accounts-but-no-holdings still returns a snapshot (NAV =
 * cash) so the PM can reason about available cash.
 *
 * FIX-762 additions: an optional `classifications` map (UPPER ticker → sector)
 * that gives `holdings[].sector` its first producer (equities only), and a
 * compact `health` block computed with the shared `summarizePortfolioHealth`
 * leaf so the trader/PM context carries the SAME household aggregates
 * (exposure, concentration, cash, coverage) the Health pane shows. Drift/
 * compliance is the FIX-761-gated slice — `health.drift` stays null in v1.
 *
 * FIX-801 addition: an optional `etfProfiles` map (UPPER ticker → stored fund
 * profile) threaded straight through to `summarizePortfolioHealth`'s own
 * optional trailing argument, so the trader/PM context gets the SAME
 * look-through second axis the Health pane shows. Per the spec's Decision 1,
 * this function does NOT fetch — the caller (`seedSession`, FIX-801 sub-PR c)
 * reads the profiles table READ-ONLY, so a run sees look-through only for
 * funds the Portfolio pane has already warmed; omitted (or empty), the health
 * block's `lookThrough` field stays null exactly as before this change
 * (BP-030 — the absent-profiles output equality guarantee this file already
 * makes for `classifications` extends to `etfProfiles`).
 *
 * Pure leaf: imports the portfolio schema types, the flow input type, and the
 * pure `portfolio-health` leaf (no runtime IO). Unit-testable without a browser.
 */
import type { PortfolioContextInput } from "./flow-schema";
import type { AccountState } from "@/domain/portfolio/schema/portfolio-schema";
import { holdingMarketValue } from "@/domain/portfolio/math/value-holding";
import {
  summarizePortfolioHealth,
  type ClassificationMap,
  type PortfolioHealth,
  type QuoteMap,
} from "@/domain/portfolio/math/portfolio-health";
import type { FundProfileInput, OpaqueFund } from "@/domain/portfolio/math/etf-look-through";

/** A live quote keyed by upper-case ticker. `price` null when unavailable. */
export type QuoteLike = { ticker: string; price: number | null; asOf: string | null };

/**
 * `OpaqueFund.reason` (`etf-look-through.ts`) mixes two genuinely different
 * kinds of "we can't attribute this fund": a TEMPORARY availability gap (never
 * fetched yet, or a fetch attempt that's currently quota/rate-limited and will
 * be retried) versus a DATA-QUALITY / structural judgment about a profile the
 * route DID successfully evaluate (too thin, malformed, leveraged, a
 * fund-of-funds, or a provider-confirmed non-ETF). Collapsing both into one
 * "(thin/ineligible data)" phrase in the analysis prompt misrepresents a fund
 * nobody has looked at yet as a data-quality finding (Codex review, FIX-801
 * sub-PR c). This is a closed set — every `opaqueByTicker.set(...)` call site
 * in `etf-look-through.ts` is enumerated here; a reason string not in
 * `UNAVAILABLE_REASONS` is treated as data-quality by default (the safer
 * default: a NEW reason class this set doesn't yet know about is far more
 * likely to be a fresh structural-exclusion case than a fresh flavor of
 * "temporarily missing").
 */
const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  "no stored profile", // never fetched
  "quota", // Alpha Vantage daily budget exhausted — retried next reset
  "transient", // network/parse failure — retried within ~15 min
]);

/** The compact household-health block projected into `<portfolioContext>` (top 6
 *  sector buckets + `Other`; concentration flags pre-rendered). Null when the
 *  book has nothing priceable (health not computable). */
function projectHealth(health: PortfolioHealth): PortfolioContextInput["health"] {
  if (health.totalNav === null) return null;
  const sectors = health.sectorExposure.slice(0, 6).map((s) => ({ bucket: s.bucket, pct: s.pct }));
  if (health.sectorExposure.length > 6) {
    const restPct = health.sectorExposure.slice(6).reduce((sum, s) => sum + (s.pct ?? 0), 0);
    sectors.push({ bucket: "Other", pct: restPct });
  }
  return {
    cashPct: health.cash.pct,
    coveragePct:
      health.coverage.totalPositions > 0
        ? (health.coverage.pricedPositions / health.coverage.totalPositions) * 100
        : null,
    assetClassAllocation: health.assetClassAllocation.map((a) => ({
      assetClass: a.assetClass,
      pct: a.pct,
    })),
    sectorExposure: sectors,
    concentration: {
      maxPosition: health.concentration.maxPosition,
      top5Pct: health.concentration.top5Pct,
      effectivePositions: health.concentration.effectivePositions,
      flags: health.concentration.flags.map((f) =>
        f.kind === "single_name"
          ? `${f.ticker} ${f.weightPct.toFixed(1)}% (${f.level})`
          : `${f.sector} ${f.weightPct.toFixed(1)}% (warn)`,
      ),
    },
    // Drift/compliance is the FIX-761-gated slice — always null until it lands.
    drift: null,
    // The look-through second axis (FIX-801) — null exactly when `lookThrough`
    // is `"none"` (no funds attributed), matching `lookThroughExposure`'s own
    // nullability on the wrapper leaf's output.
    lookThrough:
      health.lookThrough === "partial" && health.lookThroughExposure !== null
        ? {
            coveragePct: health.lookThroughExposure.coveragePct,
            sectorCoveragePct: health.lookThroughExposure.sectorCoveragePct,
            maxPosition: health.lookThroughExposure.maxPosition,
            flags: health.lookThroughExposure.flags.map((f) =>
              f.kind === "single_name"
                ? `${f.ticker} ${f.weightPct.toFixed(1)}% (${f.level}, look-through)`
                : `${f.sector} ${f.weightPct.toFixed(1)}% (warn, look-through)`,
            ),
            // `opaqueFunds` holds one entry per FAILED AXIS, not per fund — a
            // fund opaque on both the name and sector axes (via two separate
            // entries, when it isn't a single combined "both" reason) would
            // double-count under a bare `.length`. Dedupe by ticker so the
            // seed reports the true opaque-FUND count to the analysis model
            // (Codex review, FIX-801 sub-PR c), and separately count how many
            // of those are merely temporarily unavailable rather than a
            // data-quality finding (Codex review round 2 — see
            // `classifyOpaqueFunds`).
            ...classifyOpaqueFunds(health.lookThroughExposure.opaqueFunds),
          }
        : null,
  };
}

/**
 * Reduce a fund's-worth of `OpaqueFund` entries to the two counts the prompt
 * line needs: the true per-fund opaque count (deduped by ticker — see the
 * call site's comment) and the subset of those that are merely
 * temporarily unavailable (`UNAVAILABLE_REASONS`) rather than a genuine
 * data-quality finding. A ticker's reason is availability-class in EVERY
 * entry it has, or in NONE of them — the availability reasons all
 * short-circuit via a single combined `{ axis: "both" }` entry in
 * `etf-look-through.ts` before the code ever reaches the per-axis
 * (names/sectors) logic that can split one ticker into two entries, so
 * checking just the first entry per ticker is sufficient.
 */
function classifyOpaqueFunds(
  opaqueFunds: ReadonlyArray<OpaqueFund>,
): { opaqueFundCount: number; opaqueUnavailableFundCount: number } {
  const uniqueByTicker = new Map(opaqueFunds.map((f) => [f.ticker, f]));
  let opaqueUnavailableFundCount = 0;
  for (const f of uniqueByTicker.values()) {
    if (f.axis === "both" && UNAVAILABLE_REASONS.has(f.reason)) {
      opaqueUnavailableFundCount++;
    }
  }
  return { opaqueFundCount: uniqueByTicker.size, opaqueUnavailableFundCount };
}

/**
 * Build the snapshot. `quotes` is the last-known quote rows for the held tickers
 * (`app.quotes`, FIX-823; may be empty/stale); `snapshotAsOf` is the oldest quote
 * `asOf` among them ("as of at least"). `accounts` is read-only (never mutated)
 * so callers can pass a `Readonly<AccountState>[]` straight from the repository
 * projection without copying.
 */
export function buildPortfolioContext(
  accounts: ReadonlyArray<Readonly<AccountState>>,
  quotes: QuoteLike[],
  snapshotAsOf: string | null,
  classifications: ClassificationMap = new Map(),
  etfProfiles: ReadonlyMap<string, FundProfileInput> = new Map(),
): PortfolioContextInput | null {
  if (accounts.length === 0) return null;

  const priceByTicker = new Map<string, number | null>();
  for (const q of quotes) priceByTicker.set(q.ticker.toUpperCase(), q.price);

  // First pass: per-holding market value (null when no live price), and the NAV
  // from known market values + cash.
  type Row = {
    ticker: string;
    account: string;
    marketValue: number | null;
    costBasis: number | null;
    isEquity: boolean;
  };
  const rows: Row[] = [];
  let knownMarketValueTotal = 0;
  let cashTotal = 0;
  let totalHoldings = 0;
  let pricedHoldings = 0;

  for (const acc of accounts) {
    cashTotal += acc.cashBalance;
    for (const h of acc.holdings) {
      totalHoldings += 1;
      // Value BY TYPE (FIX-773 Slice C): equity via the live quote, a bond/option
      // at its carried statement mark, MMF/cash at par — the rule lives in ONE
      // place (`value-holding.ts`), shared with the holdings table. So a
      // majority-bond/MMF book contributes its real mass to NAV, not a sliver.
      const price = priceByTicker.get(h.ticker.toUpperCase()) ?? null;
      // A FIX-876 `inconsistent_history` holding (an unaccounted split over-sold
      // the ledger) has a meaningless quantity 0 — valuing it would assert a $0 /
      // 0%-weight position to the trader/PM. Treat it as UNKNOWN (null): it counts
      // toward `totalHoldings` (coverage honesty) but not `pricedHoldings`/NAV, and
      // its weight is null — surfaced as an inconsistent input, never a fake $0.
      const marketValue =
        h.dataQuality === "inconsistent_history" ? null : holdingMarketValue(h, { price });
      if (marketValue != null) {
        knownMarketValueTotal += marketValue;
        pricedHoldings += 1;
      }
      rows.push({
        ticker: h.ticker,
        account: acc.accountId,
        marketValue,
        costBasis: h.costBasis,
        isEquity: h.assetType === "equity",
      });
    }
  }

  const totalNav = knownMarketValueTotal + cashTotal;

  // Second pass: weights from the now-known NAV. Weight is null when the
  // holding's market value is unknown OR the NAV is not positive (never divide
  // by zero, never fabricate a weight).
  const holdings: PortfolioContextInput["holdings"] = rows.map((r) => ({
    ticker: r.ticker,
    account: r.account,
    marketValue: r.marketValue,
    costBasis: r.costBasis,
    // The dead `sector` field gets its first producer (FIX-762): the classification
    // for equities, null for every other type (funds/bonds/crypto/cash have no
    // single-name sector). Absent classification → null, never guessed.
    sector: r.isEquity ? (classifications.get(r.ticker.toUpperCase()) ?? null) : null,
    weightPct:
      r.marketValue != null && totalNav > 0 ? (r.marketValue / totalNav) * 100 : null,
  }));

  const accountInputs: PortfolioContextInput["accounts"] = accounts.map((a) => ({
    id: a.accountId,
    label: a.name,
    type: a.type,
    cash: a.cashBalance,
  }));

  // The compact household-health aggregate (FIX-762) — computed with the SAME
  // pure leaf the Health pane uses, so the trader/PM see the exact figures the
  // user sees. A quote map from the same rows the NAV was valued from.
  const quoteMap: QuoteMap = new Map();
  for (const q of quotes) quoteMap.set(q.ticker.toUpperCase(), { price: q.price, asOf: q.asOf });
  const health = projectHealth(
    summarizePortfolioHealth(accounts, quoteMap, classifications, snapshotAsOf, etfProfiles),
  );

  return {
    totalNav,
    snapshotAsOf,
    pricedHoldings,
    totalHoldings,
    accounts: accountInputs,
    holdings,
    health,
  };
}

/**
 * The analyzed ticker's HOUSEHOLD weight (% of the full-book NAV) from a computed
 * snapshot — the reference the FIX-761 household `maxPositionWeightPct` cap and
 * exclusion no-add are measured against. Built at seed from the pre-scoping
 * `allAccounts` snapshot so a scoped run still measures a household cap against
 * the household, not one account.
 *
 * Three honest outcomes:
 *   - `0` — the name is NOT held (initiating a position). A real zero, not unknown.
 *   - a positive number — the name is held and EVERY holding for it is priced;
 *     the sum of the rows' weights for the ticker.
 *   - `null` — the name IS held but AT LEAST ONE of its holdings can't be priced.
 *     UNKNOWN — a partial sum would UNDERSTATE the true
 *     household weight, so the cap floor (`max(cap, weight)`) could sit too low and
 *     force a trim of an actually-larger position. The policy gate must skip the
 *     clamp rather than act on an incomplete weight (a `?? 0` / partial sum would
 *     fabricate a forced trim / no-add violation, BP-020).
 */
export function householdTickerWeight(
  snapshot: PortfolioContextInput | null,
  ticker: string,
): number | null {
  const tickerUpper = ticker.toUpperCase();
  const rows = (snapshot?.holdings ?? []).filter(
    (h) => h.ticker.toUpperCase() === tickerUpper,
  );
  if (rows.length === 0) return 0; // not held → initiating
  // ANY unpriced lot → the household weight is unknowable: a partial sum would
  // understate it and the gate could clamp/force-trim an actually-larger position.
  if (rows.some((h) => h.weightPct == null)) return null;
  return rows.reduce((s, h) => s + (h.weightPct ?? 0), 0);
}
