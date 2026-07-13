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
 * Pure leaf: imports only the portfolio schema types + the flow input type
 * (types only — no runtime). Unit-testable without a browser.
 */
import type { PortfolioContextInput } from "./flow-schema";
import type { AccountState } from "../portfolio/portfolio-schema";
import { holdingMarketValue } from "../portfolio/value-holding";

/** A live quote keyed by upper-case ticker. `price` null when unavailable. */
export type QuoteLike = { ticker: string; price: number | null; asOf: string | null };

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
    sector: null, // Slice 4 does not store sector; honest null, not guessed.
    weightPct:
      r.marketValue != null && totalNav > 0 ? (r.marketValue / totalNav) * 100 : null,
  }));

  const accountInputs: PortfolioContextInput["accounts"] = accounts.map((a) => ({
    id: a.accountId,
    label: a.name,
    type: a.type,
    cash: a.cashBalance,
  }));

  return {
    totalNav,
    snapshotAsOf,
    pricedHoldings,
    totalHoldings,
    accounts: accountInputs,
    holdings,
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
 *   - a positive number — the name is held and at least one holding is priced;
 *     the sum of the priced rows' weights for the ticker.
 *   - `null` — the name IS held but NONE of its holdings can be priced (or the
 *     snapshot is null). UNKNOWN — the policy gate must skip the clamp rather than
 *     coerce to 0 (a `?? 0` would fabricate a full exit / forced trim, BP-020).
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
  const priced = rows.filter((h) => h.weightPct != null);
  if (priced.length === 0) return null; // held but entirely unpriced → unknown
  return priced.reduce((s, h) => s + (h.weightPct ?? 0), 0);
}
