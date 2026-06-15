"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Minimal data-fetching hook for the app's own JSON API routes: fetch `url`,
 * parse the body as `T`, and expose an explicit `refetch`. Reusable across
 * queries — pass the URL and the response type. Deliberately small: no caching,
 * request dedup, or loading/error surface yet; add them when a consumer needs
 * one (the first consumer is `usePortfolioAccounts`, FIX-772).
 */
export function useApiQuery<T>(url: string): { data: T | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);

  const refetch = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        setData((await res.json()) as T);
      } catch (err) {
        console.error(`[trading-desk] useApiQuery failed: ${url}`, err);
      }
    })();
  }, [url]);

  // Initial load + reload when the URL changes. A genuine data fetch (external
  // sync), so an effect is correct here (BP-010).
  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, refetch };
}
