"use client";

import { useMemo } from "react";
import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { ClassificationsResponse } from "@/app/api/portfolio/classifications/route";
import type { ClassificationMap } from "@/src/domain/portfolio/math/portfolio-health";

/**
 * Read (and lazily fill) per-ticker sector classifications (FIX-762) for the
 * Health view's sector axis, via `/api/portfolio/classifications`. A thin
 * `useApiQuery` wrapper — the route derives the held equity tickers server-side
 * from the user's holdings (the `useQuotes` precedent), so this hook passes only
 * `userId`, never a client-computed ticker list. A no-equity book resolves to an
 * empty map server-side (no Yahoo fan-out).
 *
 * When the route self-heals a mistyped fund/crypto holding, `reclassifiedTickers`
 * lists the tickers it actually corrected so the Health section can refetch
 * accounts (the route mutates holdings; the prop-fed `accounts` would otherwise
 * stay stale until a later reload).
 *
 * Mounted by the Health section ONLY, so opening Accounts / Gains never triggers
 * a classification fetch.
 */
export function useClassifications(): {
  classifications: ClassificationMap;
  reclassifiedTickers: string[];
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data } = useApiQuery<ClassificationsResponse>(
    `/api/portfolio/classifications?userId=${encodeURIComponent(uid)}`,
  );

  const classifications = useMemo<ClassificationMap>(() => {
    const map: ClassificationMap = new Map();
    for (const c of data?.classifications ?? []) map.set(c.ticker.toUpperCase(), c.sector);
    return map;
  }, [data]);

  const reclassifiedTickers = useMemo(
    () => data?.reclassifiedTickers ?? [],
    [data],
  );

  return { classifications, reclassifiedTickers };
}
