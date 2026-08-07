"use client";

import { useApiQuery } from "@/lib/use-api-query";
import type { IncomeSummaryRow } from "@/db/repository";

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
  const { data, refetch } = useApiQuery<{ income: IncomeSummaryRow[] }>(
    "/api/portfolio/income",
  );
  return { income: data?.income ?? [], refetch };
}
