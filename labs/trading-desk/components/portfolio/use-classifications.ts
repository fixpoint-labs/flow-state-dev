"use client";

import { useMemo } from "react";
import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { ClassificationEntry } from "@/app/api/portfolio/classifications/route";
import type { ClassificationMap } from "@/src/flows/portfolio/portfolio-health";

/**
 * Read (and lazily fill) per-ticker sector classifications (FIX-762) for the
 * Health view's sector axis, via `/api/portfolio/classifications`. A thin
 * `useApiQuery` wrapper — the route derives the held equity tickers server-side
 * from the user's holdings (the `useQuotes` precedent), so this hook passes only
 * `userId`, never a client-computed ticker list. A no-equity book resolves to an
 * empty map server-side (no Yahoo fan-out).
 *
 * Mounted by the Health section ONLY, so opening Accounts / Gains never triggers
 * a classification fetch.
 */
export function useClassifications(): { classifications: ClassificationMap } {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data } = useApiQuery<{ classifications: ClassificationEntry[] }>(
    `/api/portfolio/classifications?userId=${encodeURIComponent(uid)}`,
  );

  const classifications = useMemo<ClassificationMap>(() => {
    const map: ClassificationMap = new Map();
    for (const c of data?.classifications ?? []) map.set(c.ticker.toUpperCase(), c.sector);
    return map;
  }, [data]);

  return { classifications };
}
