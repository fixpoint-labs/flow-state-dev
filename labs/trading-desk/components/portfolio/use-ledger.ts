"use client";

import { useEffect, useRef } from "react";
import { useFlowContext, type SessionView } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { LedgerRow } from "@/src/flows/portfolio/ledger-schema";

/**
 * Read the user's transaction ledger (FIX-774) from the app-owned table via the
 * `/api/portfolio/ledger` read route. Mirrors `usePortfolioAccounts` exactly:
 * the ledger is NOT an FSD resource (it lives in the same app-owned tables as
 * accounts/holdings), so this is built on `useApiQuery` with the same
 * stream-settle refetch backstop.
 *
 * Convergence after a write: `session.sendAction("recordLedgerEvent", ...)`
 * resolves at the SSE response headers, BEFORE the handler's DB write commits,
 * and the ledger emits no `resource_change` to auto-invalidate. So in addition
 * to `useApiQuery`'s explicit `refetch` (called by the pane after each action),
 * this refetches on the true→false edge of `isStreaming` — the write commits as
 * the request completes, so that edge is the correct settle point.
 */
export function useLedger(session: SessionView): {
  events: LedgerRow[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ events: LedgerRow[] }>(
    `/api/portfolio/ledger?userId=${encodeURIComponent(uid)}`,
  );

  // Backstop: refetch when an in-flight action on this session completes, so a
  // write's committed result lands even though `sendAction` resolved earlier.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !session.isStreaming) refetch();
    wasStreaming.current = session.isStreaming;
  }, [session.isStreaming, refetch]);

  return { events: data?.events ?? [], refetch };
}
