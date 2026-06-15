"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFlowContext, type SessionView } from "@flow-state-dev/react";
import type { AccountState } from "@/src/flows/portfolio/portfolio-schema";

/**
 * Read the user's portfolio (accounts with inline holdings) from the app-owned
 * tables via the read API route (FIX-772). Accounts are no longer an FSD
 * resource, so this replaces `useResourceCollectionList(session, "accounts")`.
 *
 * Convergence after a write: `session.sendAction(...)` resolves at the SSE
 * response headers, BEFORE the handler's DB write commits, and accounts emit no
 * `resource_change` event to auto-invalidate (they aren't resources). So an
 * explicit `refetch()` right after `sendAction` can read stale rows. To restore
 * the convergence the old collection hook had, this also refetches when an
 * in-flight action on `session` finishes (the true→false edge of `isStreaming`)
 * — the write commits as the request completes, so that edge is the correct
 * settle point. The explicit `refetch` stays for immediacy; this is the backstop.
 */
export function usePortfolioAccounts(session: SessionView): {
  accounts: AccountState[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const [accounts, setAccounts] = useState<AccountState[]>([]);

  const refetch = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/portfolio/accounts?userId=${encodeURIComponent(uid)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { accounts: AccountState[] };
        setAccounts(data.accounts);
      } catch (err) {
        console.error("[trading-desk] fetch portfolio accounts failed", err);
      }
    })();
  }, [uid]);

  // Initial load + reload when the user changes. A genuine data fetch (external
  // sync), so an effect is correct here (BP-010).
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Backstop: refetch when an in-flight action on this session completes, so a
  // write's committed result lands even though `sendAction` resolved earlier.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !session.isStreaming) refetch();
    wasStreaming.current = session.isStreaming;
  }, [session.isStreaming, refetch]);

  return { accounts, refetch };
}
