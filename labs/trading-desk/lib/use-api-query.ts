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
 *
 * A `null` URL skips the fetch entirely (`data` stays null) — for a consumer
 * whose query is conditional on input it doesn't always have (e.g. the Health
 * view fetches classifications only when the book holds equities).
 */
export function useApiQuery<T>(url: string | null): { data: T | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  // Monotonic request counter — the last refetch to start owns the result.
  const latestRequestId = useRef(0);

  const refetch = useCallback(() => {
    if (url === null) return;
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

/**
 * Fire a mutating request against one of the app's own JSON routes and return
 * the parsed result. The portfolio write surface is plain REST (FIX-736 follow-
 * up): a mutation is an awaited `fetch` that returns its real result — no flow
 * round-trip, no request envelope, no stream-settle refetch guessing. The
 * caller `await`s this, then triggers the relevant `refetch`. Throws on a
 * non-2xx response, surfacing the route's `{ error }` message when present so
 * the caller can show it.
 */
export async function apiMutate<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => null);
    throw new Error(message ?? `${method} ${url} failed (${res.status})`);
  }
  return (await res.json()) as T;
}
