"use client";

import { useEffect, useRef } from "react";
import { useFlowContext, type SessionView } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { IncomeSummaryRow } from "@/src/db/repository";

/**
 * Read the user's ledger-derived income summary (dividends + interest per
 * account/ticker) from the `/api/portfolio/income` read route. Mirrors
 * `useLedger` exactly — the same app-owned-table read path and the same
 * stream-settle refetch backstop, because the same writes (an ingest, a void)
 * that move the ledger also move the income aggregate.
 */
export function useIncome(session: SessionView): {
  income: IncomeSummaryRow[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ income: IncomeSummaryRow[] }>(
    `/api/portfolio/income?userId=${encodeURIComponent(uid)}`,
  );

  // Backstop: refetch when an in-flight action on this session completes, so a
  // write's committed result lands even though `sendAction` resolved earlier.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !session.isStreaming) refetch();
    wasStreaming.current = session.isStreaming;
  }, [session.isStreaming, refetch]);

  return { income: data?.income ?? [], refetch };
}
