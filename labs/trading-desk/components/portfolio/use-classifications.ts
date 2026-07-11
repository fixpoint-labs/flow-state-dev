"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/lib/use-api-query";
import type { ClassificationEntry } from "@/app/api/portfolio/classifications/route";
import type { ClassificationMap } from "@/src/flows/portfolio/portfolio-health";

/**
 * Read (and lazily fill) per-ticker sector classifications (FIX-762) for the
 * Health view's sector axis, via `/api/portfolio/classifications`. A thin
 * `useApiQuery` wrapper keyed on the SORTED ticker list, so the URL is stable
 * across renders that don't change the held set.
 *
 * Mounted by the Health section ONLY — opening Accounts / Gains never triggers a
 * Yahoo fan-out. When the book holds no equities the ticker list is empty and the
 * hook makes no request (null URL), returning an empty map (funds/bonds/crypto/
 * cash don't use the sector axis).
 */
export function useClassifications(tickers: string[]): { classifications: ClassificationMap } {
  // Sort + de-dupe for a stable cache key regardless of holding order.
  const sorted = useMemo(
    () => [...new Set(tickers.map((t) => t.toUpperCase()))].sort(),
    [tickers],
  );
  const url = sorted.length
    ? `/api/portfolio/classifications?tickers=${encodeURIComponent(sorted.join(","))}`
    : null;
  const { data } = useApiQuery<{ classifications: ClassificationEntry[] }>(url);

  const classifications = useMemo<ClassificationMap>(() => {
    const map: ClassificationMap = new Map();
    for (const c of data?.classifications ?? []) map.set(c.ticker.toUpperCase(), c.sector);
    return map;
  }, [data]);

  return { classifications };
}
