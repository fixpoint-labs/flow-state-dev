"use client";

import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { IncomeSummaryRow } from "@/src/db/repository";

/**
 * Read the user's ledger-derived income summary (dividends + interest per
 * account/ticker) from the `/api/portfolio/income` read route. A thin
 * `useApiQuery` wrapper — the same writes that move the ledger (record event /
 * import) move this aggregate, and the pane refetches income right after each,
 * so no stream-settle backstop is needed (FIX-736 follow-up).
 */
export function useIncome(): {
  income: IncomeSummaryRow[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ income: IncomeSummaryRow[] }>(
    `/api/portfolio/income?userId=${encodeURIComponent(uid)}`,
  );
  return { income: data?.income ?? [], refetch };
}
