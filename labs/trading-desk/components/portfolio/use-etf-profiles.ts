"use client";

import { useMemo } from "react";
import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { AccountState } from "@/domain/portfolio/schema/portfolio-schema";
import type { Quote } from "@/domain/portfolio/services/get-quotes";
import { isEtfProfileFetchCandidate, type FundProfileRowInput } from "@/domain/portfolio/math/etf-profile-map";
import { dominantClassificationByTicker, holdingMarketValue } from "@/domain/portfolio/math/value-holding";
import { isKnownBondEtf } from "@/domain/portfolio/math/classify-instrument";
import { hasShortPosition } from "@/domain/portfolio/math/etf-look-through";
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
 * narrowed to funds that are BOTH priced and fetch-eligible
 * (`isEtfProfileFetchCandidate` — the SAME predicate the route fetches
 * against, so this hook's `sig` param and the route's actual fetch set agree)
 * — and both of those inputs settle asynchronously after holdings load.
 * (The analysis seed's read set is DELIBERATELY broader than this predicate
 * — see `isEtfProfileFetchCandidate`'s own docblock for why fetch-eligibility
 * and read-eligibility are different questions.) `useApiQuery`'s stable-URL
 * query only re-runs when its URL changes, so a fund whose eligibility
 * resolves late is otherwise missed for the whole session:
 *   - **Prices.** On a cold mount the route runs before any quote exists,
 *     skips every fund as unpriced, and returns nothing.
 *   - **Classifications.** A ticker-shaped ETF imported with no type hint
 *     starts as `equity`; the classifications route may asynchronously
 *     correct it to `etf` (health-section.tsx already refetches `accounts`
 *     when that happens — see `reclassifiedTickers`).
 * Rather than a bespoke refetch call per trigger, ONE derived signature over
 * exactly the eligibility-relevant slice of `accounts` (ticker + assetType) +
 * `priceMap` (which tickers are priced) feeds the query URL — HASHED, not
 * embedded raw (`hashEligibilitySignature`), so a large book's full ticker
 * list never lands in the URL/access logs and can't blow past a request-
 * target size limit — so `useApiQuery`'s existing "reload on URL change"
 * behavior does the refetch — a future eligibility input (a third trigger)
 * costs nothing; it just joins the signature. Both known triggers (a quote
 * resolving, a classification correction propagating through the `accounts`
 * refetch) flow through `accounts`/`priceMap`, which are already props
 * re-rendering into this hook, so no additional wiring is needed beyond
 * building the signature from them.
 *
 * Returns two ticker-keyed maps: `profiles` (attributable — even a THIN one
 * below the coverage floor; that gate is the consuming leaf's business, not
 * this hook's) and `refusals` (opaque, with why). A ticker in neither map has
 * simply never been fetched yet (deferred by the per-call miss cap) — not a
 * third state this hook needs to represent.
 */
/**
 * The one derived key the eligibility-refetch fix rests on — a pure,
 * standalone function (not inlined into the hook) so it stays unit-testable
 * without a React render (this codebase has no jsdom/component-test harness
 * yet). Order-independent (sorted) so re-fetching in a different account
 * order doesn't spuriously change the signature and trigger a needless
 * refetch.
 *
 * Computed PER TICKER, not per row — the route's own fetch-eligibility
 * decision is per-ticker too (several holdings of the same ticker across
 * accounts collapse to one verdict). Each ticker's row is four independent
 * `:`-separated fields, plus one trailing portfolio-wide suffix; each field
 * mirrors a distinct condition `route.ts` gates fetching on, kept
 * independent of the others (never folded into a single combined bit)
 * specifically so the signature changes exactly when the route's own
 * eligible set would, regardless of WHICH input resolved late:
 *
 *   1. `isCandidate` — at least one held row passes `isEtfProfileFetchCandidate`
 *      (the SAME per-row predicate the route's local-tag fetch path uses:
 *      ETF-typed, not a curated bond ETF, not flagged `inconsistent_history`)
 *      AND the ticker clears the fixed-income check (field 3). A holding the
 *      route will never fetch (a mutual fund, a curated bond ETF, a flagged
 *      row) must not change this field, or a household holding one would
 *      trigger a spurious refetch for a ticker that was never going to be
 *      warmed. (The analysis seed's own read set is deliberately broader —
 *      see `isEtfProfileFetchCandidate`'s own docblock.)
 *   2. `isPriced` — whether `priceMap` has a quote for the ticker yet.
 *   3. `dominantEligibleForRefresh` — the ticker's DOMINANT (largest-
 *      market-value) lot's `assetClass` isn't `fixed_income`, AND the ticker
 *      isn't a curated bond ETF (`isKnownBondEtf`) — the same fixed-income
 *      exclusion `route.ts` applies to BOTH its local-tag candidate set and
 *      its cache-confirmed refresh set (a ticker with an existing successful
 *      cached profile, refresh-eligible regardless of the local `assetType`
 *      tag). Tracked independently of `isCandidate` because for a ticker
 *      whose local tag never reads "etf", `isCandidate` stays 0 no matter
 *      what — a dominant-lot transition needs its own field to ever reach
 *      the signature for that ticker.
 *   4. `hasCleanRow` — at least one held row for the ticker ISN'T flagged
 *      `inconsistent_history` (FIX-876). Mirrors a second guard on the
 *      route's cache-confirmed refresh path: a ticker held only in flagged
 *      rows can still clear field 3's fixed-income check, so this field
 *      independently gates that case, for the same reason field 3 can't be
 *      folded into `isCandidate`.
 *   5. A trailing `|short:0|1` PORTFOLIO-WIDE suffix, not a per-ticker
 *      field — mirrors `route.ts`'s portfolio-wide short-position check:
 *      whenever ANY priced non-cash position (ticker-merged across
 *      accounts) has a negative or non-finite market value, the route skips
 *      ALL ETF-profile fetches, since `computeLookThroughExposure` refuses
 *      the whole look-through axis regardless of what's fetched. Reuses
 *      `hasShortPosition` (`etf-look-through.ts`) directly — the SAME
 *      exported predicate `route.ts` calls — over a market-value map built
 *      the identical way (`holdingMarketValue` summed per ticker, excluding
 *      `inconsistent_history` rows, `dominantClassification` for the cash
 *      exclusion). Appended only when there's at least one ticker — an
 *      empty, holding-less book still returns `""`.
 */
export function computeEtfEligibilitySignature(
  accounts: ReadonlyArray<Pick<AccountState, "holdings">>,
  priceMap: ReadonlyMap<string, Quote>,
): string {
  const holdings = accounts.flatMap((acc) => acc.holdings);
  const dominantClassification = dominantClassificationByTicker(holdings, priceMap);
  const candidateRowTickers = new Set(
    holdings.filter(isEtfProfileFetchCandidate).map((h) => h.ticker.toUpperCase()),
  );
  const cleanRowTickers = new Set(
    holdings.filter((h) => h.dataQuality !== "inconsistent_history").map((h) => h.ticker.toUpperCase()),
  );
  const tickers = new Set(holdings.map((h) => h.ticker.toUpperCase()));
  const rows: string[] = [];
  for (const ticker of tickers) {
    const dominantEligibleForRefresh =
      dominantClassification.get(ticker)?.assetClass !== "fixed_income" && !isKnownBondEtf(ticker);
    const isCandidate = candidateRowTickers.has(ticker) && dominantEligibleForRefresh;
    const isPriced = priceMap.has(ticker);
    const hasCleanRow = cleanRowTickers.has(ticker);
    rows.push(
      `${ticker}:${isCandidate ? 1 : 0}:${isPriced ? 1 : 0}:${dominantEligibleForRefresh ? 1 : 0}:${hasCleanRow ? 1 : 0}`,
    );
  }
  if (rows.length === 0) return "";

  // Mirrors route.ts's hasShortPosition check exactly — see field 5 above.
  const mergedMarketValueByTicker = new Map<string, number>();
  for (const h of holdings) {
    if (h.dataQuality === "inconsistent_history") continue;
    const mv = holdingMarketValue(h, priceMap.get(h.ticker.toUpperCase()));
    if (mv === null) continue;
    const ticker = h.ticker.toUpperCase();
    mergedMarketValueByTicker.set(ticker, (mergedMarketValueByTicker.get(ticker) ?? 0) + mv);
  }
  const portfolioHasShortPosition = hasShortPosition(
    [...mergedMarketValueByTicker].map(([ticker, marketValue]) => ({
      assetClass: dominantClassification.get(ticker)?.assetClass ?? "equity",
      assetType: dominantClassification.get(ticker)?.assetType ?? "equity",
      marketValue,
    })),
  );

  return `${rows.sort().join(",")}|short:${portfolioHasShortPosition ? 1 : 0}`;
}

/**
 * Compact a (potentially large) `computeEtfEligibilitySignature` string into
 * a short, URL-safe token via a fast, non-cryptographic 32-bit FNV-1a hash.
 * Embedding the RAW signature directly in the query string — every held
 * ticker plus its eligibility bits — would leak the household's full ticker
 * list into browser history / access logs, and for a large book risks
 * exceeding a proxy's request-target size limit and breaking the request
 * outright (Codex review, FIX-801 sub-PR c). Only the CHANGE-DETECTION
 * property matters here, not the content, so a hash token is the right
 * shape: `useApiQuery`'s stable-URL refetch still fires exactly when the
 * signature changes. Not cryptographic — a collision would only cause a
 * missed refetch (self-healing on the next real eligibility change, since
 * the underlying `accounts`/`priceMap` inputs keep re-rendering), never
 * wrong data, since the route still derives its own eligible ticker set
 * server-side regardless of what `sig` says.
 */
export function hashEligibilitySignature(signature: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
  // Hashed, not embedded raw — see `hashEligibilitySignature`'s docblock.
  const sigToken = useMemo(
    () => hashEligibilitySignature(eligibilitySignature),
    [eligibilitySignature],
  );

  const { data } = useApiQuery<EtfProfilesResponse>(
    `/api/portfolio/etf-profiles?userId=${encodeURIComponent(uid)}&sig=${sigToken}`,
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

/**
 * Convert this hook's two ticker-keyed maps into the flat row shape
 * `toFundProfileMap` (`domain/portfolio/math/etf-profile-map.ts`) expects —
 * the client-side half of the "one conversion, two consumers" adapter (the
 * analysis seed converts the repository's `EtfProfileRow[]` directly; this is
 * the Health UI's equivalent over the route's two-array client projection).
 * Pulled out of `health-section.tsx` (a review trim, FIX-801 sub-PR c) so the
 * component doesn't hand-rebuild payload objects inline — one place knows the
 * `EtfProfileEntry` → `NormalizedFundProfile`-shaped payload mapping.
 */
export function etfProfilesResponseToRows(
  profiles: ReadonlyMap<string, EtfProfileEntry>,
  refusals: ReadonlyMap<string, EtfProfileRefusalEntry>,
): FundProfileRowInput[] {
  return [
    ...[...profiles.values()].map((p) => ({
      ticker: p.ticker,
      payload: {
        leveraged: p.leveraged,
        constituents: p.constituents,
        nameCoverage: p.nameCoverage,
        sectors: p.sectors,
        sectorCoverage: p.sectorCoverage,
      },
      refusalReason: null,
    })),
    ...[...refusals.values()].map((r) => ({
      ticker: r.ticker,
      payload: null,
      refusalReason: r.reason,
    })),
  ];
}
