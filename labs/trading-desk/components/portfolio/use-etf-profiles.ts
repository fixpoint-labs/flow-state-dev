"use client";

import { useMemo } from "react";
import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { AccountState } from "@/domain/portfolio/schema/portfolio-schema";
import type { Quote } from "@/domain/portfolio/services/get-quotes";
import type {
  EtfProfileEntry,
  EtfProfileRefusalEntry,
  EtfProfilesResponse,
} from "@/app/api/portfolio/etf-profiles/route";

/**
 * Read (and lazily fill) ETF holdings profiles (FIX-801) for the Health view's
 * look-through axis, via `/api/portfolio/etf-profiles`. A thin `useApiQuery`
 * wrapper — the route derives the eligible fund tickers server-side from the
 * user's holdings (the `useClassifications` precedent), so this hook never
 * sends a client-computed ticker list. A fund-less book resolves to empty maps
 * server-side (no Alpha Vantage fan-out).
 *
 * **The eligibility-refetch fix.** The route's own fetch set (Decision 5) is
 * narrowed to funds that are BOTH priced and classified as a fund — and both
 * of those inputs settle asynchronously after holdings load. `useApiQuery`'s
 * stable-URL query only re-runs when its URL changes, so a fund whose
 * eligibility resolves late is otherwise missed for the whole session:
 *   - **Prices.** On a cold mount the route runs before any quote exists,
 *     skips every fund as unpriced, and returns nothing.
 *   - **Classifications.** A ticker-shaped ETF imported with no type hint
 *     starts as `equity`; the classifications route may asynchronously
 *     correct it to `etf` (health-section.tsx already refetches `accounts`
 *     when that happens — see `reclassifiedTickers`).
 * Rather than a bespoke refetch call per trigger, ONE derived signature over
 * exactly the eligibility-relevant slice of `accounts` (ticker + assetType) +
 * `priceMap` (which tickers are priced) feeds the query URL, so
 * `useApiQuery`'s existing "reload on URL change" behavior does the refetch —
 * a future eligibility input (a third trigger) costs nothing; it just joins
 * the signature. Both known triggers (a quote resolving, a classification
 * correction propagating through the `accounts` refetch) flow through
 * `accounts`/`priceMap`, which are already props re-rendering into this hook,
 * so no additional wiring is needed beyond building the signature from them.
 *
 * Returns two ticker-keyed maps: `profiles` (attributable — even a THIN one
 * below the coverage floor; that gate is the consuming leaf's business, not
 * this hook's) and `refusals` (opaque, with why). A ticker in neither map has
 * simply never been fetched yet (deferred by the per-call miss cap) — not a
 * third state this hook needs to represent.
 */
/**
 * The one derived key the hole fix rests on — a pure, standalone function
 * (not inlined into the hook) specifically so it is unit-testable without a
 * React render (this codebase has no jsdom/component-test harness yet — see
 * the FIX-801 sub-PR c PR description). Order-independent (sorted) so
 * re-fetching in a different account order doesn't spuriously change the
 * signature and trigger a needless refetch.
 */
export function computeEtfEligibilitySignature(
  accounts: ReadonlyArray<Pick<AccountState, "holdings">>,
  priceMap: ReadonlyMap<string, Quote>,
): string {
  const rows: string[] = [];
  for (const acc of accounts) {
    for (const h of acc.holdings) {
      const ticker = h.ticker.toUpperCase();
      const isFundTyped = h.assetType === "etf" || h.assetType === "mutual_fund";
      const isPriced = priceMap.has(ticker);
      rows.push(`${ticker}:${isFundTyped ? 1 : 0}:${isPriced ? 1 : 0}`);
    }
  }
  return rows.sort().join(",");
}

export function useEtfProfiles(
  accounts: AccountState[],
  priceMap: Map<string, Quote>,
): {
  profiles: Map<string, EtfProfileEntry>;
  refusals: Map<string, EtfProfileRefusalEntry>;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";

  const eligibilitySignature = useMemo(
    () => computeEtfEligibilitySignature(accounts, priceMap),
    [accounts, priceMap],
  );

  const { data } = useApiQuery<EtfProfilesResponse>(
    `/api/portfolio/etf-profiles?userId=${encodeURIComponent(uid)}&sig=${encodeURIComponent(eligibilitySignature)}`,
  );

  const profiles = useMemo(() => {
    const map = new Map<string, EtfProfileEntry>();
    for (const p of data?.profiles ?? []) map.set(p.ticker, p);
    return map;
  }, [data]);

  const refusals = useMemo(() => {
    const map = new Map<string, EtfProfileRefusalEntry>();
    for (const r of data?.refusals ?? []) map.set(r.ticker, r);
    return map;
  }, [data]);

  return { profiles, refusals };
}
