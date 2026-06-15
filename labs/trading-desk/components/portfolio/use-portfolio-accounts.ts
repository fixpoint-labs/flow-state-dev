"use client";

import { useCallback, useEffect, useState } from "react";
import { useFlowContext } from "@flow-state-dev/react";
import type { AccountState } from "@/src/flows/portfolio/portfolio-schema";

/**
 * Read the user's portfolio (accounts with inline holdings) from the app-owned
 * tables via the read API route (FIX-772). Accounts are no longer an FSD
 * resource, so this replaces `useResourceCollectionList(session, "accounts")`.
 *
 * `refetch` is called after every write action so the pane reflects the change.
 * The resource model's `resource_change`-driven auto-refresh is now an explicit
 * refetch — which the pane already did after each action, so no behavior is lost.
 * Reads no longer require a bound session (the API route takes `userId`); the
 * pane still gates on a session for writes and the quotes resource.
 */
export function usePortfolioAccounts(): {
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

  return { accounts, refetch };
}
