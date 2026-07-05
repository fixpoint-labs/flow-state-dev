"use client";

import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { AccountState } from "@/src/flows/portfolio/portfolio-schema";

/**
 * Read the user's portfolio (accounts with inline holdings) from the app-owned
 * tables via the read API route (FIX-772). A thin `useApiQuery` wrapper — no
 * session needed, because reads and writes are both plain routes now: the pane
 * `await`s each write route and then calls `refetch`, so a mutation's committed
 * result lands deterministically. (The old `isStreaming` stream-settle backstop
 * existed only because writes were flow actions whose result never came back;
 * it's gone with them — FIX-736 follow-up.)
 */
export function usePortfolioAccounts(): {
  accounts: AccountState[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ accounts: AccountState[] }>(
    `/api/portfolio/accounts?userId=${encodeURIComponent(uid)}`,
  );
  return { accounts: data?.accounts ?? [], refetch };
}
