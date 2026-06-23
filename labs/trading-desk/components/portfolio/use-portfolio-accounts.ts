"use client";

import { useEffect, useRef } from "react";
import { useFlowContext, type SessionView } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { AccountState } from "@/src/flows/portfolio/portfolio-schema";

/**
 * Read the user's portfolio (accounts with inline holdings) from the app-owned
 * tables via the read API route (FIX-772). Accounts are no longer an FSD
 * resource, so this replaces `useResourceCollectionList(session, "accounts")` —
 * built on the reusable `useApiQuery` primitive.
 *
 * Convergence after a write: `session.sendAction(...)` resolves at the SSE
 * response headers, BEFORE the handler's DB write commits, and accounts emit no
 * `resource_change` to auto-invalidate (they aren't resources). So in addition
 * to `useApiQuery`'s explicit `refetch` (called by the pane after each action),
 * this refetches when an in-flight action on `session` finishes (the true→false
 * edge of `isStreaming`) — the write commits as the request completes, so that
 * edge is the correct settle point and restores the convergence the old
 * collection hook had.
 */
export function usePortfolioAccounts(session: SessionView): {
  accounts: AccountState[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ accounts: AccountState[] }>(
    `/api/portfolio/accounts?userId=${encodeURIComponent(uid)}`,
  );

  // Backstop: refetch when an in-flight action on this session completes, so a
  // write's committed result lands even though `sendAction` resolved earlier.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !session.isStreaming) refetch();
    wasStreaming.current = session.isStreaming;
  }, [session.isStreaming, refetch]);

  return { accounts: data?.accounts ?? [], refetch };
}
