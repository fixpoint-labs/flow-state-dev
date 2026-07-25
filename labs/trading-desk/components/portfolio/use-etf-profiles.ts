"use client";

import { useMemo } from "react";
import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type {
  EtfProfileEntry,
  EtfProfileRefusalEntry,
  EtfProfilesResponse,
} from "@/app/api/portfolio/etf-profiles/route";

/**
 * Read (and lazily fill) ETF holdings profiles (FIX-801) for the Health view's
 * look-through axis, via `/api/portfolio/etf-profiles`. A thin `useApiQuery`
 * wrapper — the route derives the eligible fund tickers server-side from the
 * user's holdings (the `useClassifications` precedent), so this hook passes
 * only `userId`, never a client-computed ticker list. A fund-less book
 * resolves to empty maps server-side (no Alpha Vantage fan-out).
 *
 * Returns two ticker-keyed maps: `profiles` (attributable — even a THIN one
 * below the coverage floor; that gate is the consuming leaf's business, not
 * this hook's) and `refusals` (opaque, with why). A ticker in neither map has
 * simply never been fetched yet (deferred by the per-call miss cap, or
 * unpriced) — not a third state this hook needs to represent.
 */
export function useEtfProfiles(): {
  profiles: Map<string, EtfProfileEntry>;
  refusals: Map<string, EtfProfileRefusalEntry>;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data } = useApiQuery<EtfProfilesResponse>(
    `/api/portfolio/etf-profiles?userId=${encodeURIComponent(uid)}`,
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
