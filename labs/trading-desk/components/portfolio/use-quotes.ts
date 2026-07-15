"use client";

import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { QuoteRow } from "@/db/repository";

/**
 * Read the user's last-known prices (FIX-823) from the durable `app.quotes` table
 * via the `/api/portfolio/quotes` read route. A thin `useApiQuery` wrapper — the
 * pane dispatches the `getQuotes` action (which upserts the table) and, once that
 * request reaches a terminal status, calls `refetch` for the committed rows. This
 * replaces the retired `portfolioQuotes` resource's live `useResource` read (the
 * FIX-772 accounts-migration pattern: REST hook + explicit refetch).
 *
 * The route derives the ticker set from the user's holdings server-side, so this
 * hook passes only `userId` (sourced from `useFlowContext`, the
 * `usePortfolioAccounts` precedent).
 */
export function useQuotes(): {
  quotes: QuoteRow[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ quotes: QuoteRow[] }>(
    `/api/portfolio/quotes?userId=${encodeURIComponent(uid)}`,
  );
  return { quotes: data?.quotes ?? [], refetch };
}
