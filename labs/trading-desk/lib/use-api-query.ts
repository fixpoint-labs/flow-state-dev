"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal data-fetching hook for the app's own JSON API routes: fetch `url`,
 * parse the body as `T`, and expose an explicit `refetch`. Reusable across
 * queries — pass the URL and the response type. Deliberately small: no caching
 * or loading/error surface yet; add them when a consumer needs one (the first
 * consumer is `usePortfolioAccounts`, FIX-772).
 *
 * Out-of-order responses are guarded: `usePortfolioAccounts` fires a `refetch`
 * after every write AND on the stream-settle edge, so two requests can be in
 * flight at once. Each `refetch` claims a monotonic id; only the response whose
 * id is still the latest applies its body, so a slow earlier fetch can never
 * overwrite a fresher one.
 */
export function useApiQuery<T>(url: string): { data: T | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  // Monotonic request counter — the last refetch to start owns the result.
  const latestRequestId = useRef(0);

  const refetch = useCallback(() => {
    const requestId = (latestRequestId.current += 1);
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const body = (await res.json()) as T;
        // Drop a stale response: a later refetch already superseded this one.
        if (requestId === latestRequestId.current) setData(body);
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
