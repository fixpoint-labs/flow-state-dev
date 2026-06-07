/**
 * Build the `portfolioContextInput` snapshot the `analyze` action dispatches,
 * from the Slice-4 stored accounts + the live `portfolioQuotes` resource.
 *
 * THE LOAD-BEARING INTEGRATION (BUILD_PLAN portfolio-shape alignment). Slice 4
 * stores `quantity` / `costBasis` per holding but NOT market value, weight, NAV,
 * or sector. Weights are computed once at seed; the flow never recomputes. So
 * this pure, browser-safe function (called server-side in `seedSession`,
 * `orchestration/guards.ts`) computes the snapshot:
 *   - per-holding `marketValue` = quantity × live quote (null when no quote)
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

/** A live quote keyed by upper-case ticker. `price` null when unavailable. */
export type QuoteLike = { ticker: string; price: number | null; asOf: string | null };

/**
 * Build the snapshot. `quotes` is the `portfolioQuotes` resource's quote array
 * (may be empty/stale); `snapshotAsOf` is its fetch time. `accounts` is read-only
 * (never mutated) so callers can pass a `Readonly<AccountState>[]` straight from
 * a resource ref without copying.
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
      const price = priceByTicker.get(h.ticker.toUpperCase()) ?? null;
      const marketValue = price != null ? h.quantity * price : null;
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
