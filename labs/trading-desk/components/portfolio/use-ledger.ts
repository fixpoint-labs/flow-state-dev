"use client";

import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { LedgerRow } from "@/src/flows/portfolio/ledger-schema";

/**
 * Read the user's transaction ledger (FIX-774) from the app-owned table via the
 * `/api/portfolio/ledger` read route. A thin `useApiQuery` wrapper — the pane
 * `await`s each write route (record event / import) and calls `refetch`, so the
 * committed rows land without the old stream-settle backstop (FIX-736 follow-up).
 */
export function useLedger(): {
  events: LedgerRow[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ events: LedgerRow[] }>(
    `/api/portfolio/ledger?userId=${encodeURIComponent(uid)}`,
  );
  return { events: data?.events ?? [], refetch };
}
