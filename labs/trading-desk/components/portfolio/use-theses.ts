"use client";

import { useEffect, useRef } from "react";
import { useFlowContext, type SessionView } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type { ThesisRecord } from "@/src/flows/portfolio/thesis-schema";

/**
 * Read the household's per-position theses (FIX-760) from the app-owned
 * `app.theses` table via the `/api/portfolio/theses` read route. Mirrors
 * `useLedger` / `usePortfolioAccounts` exactly: theses are NOT an FSD resource
 * (they live in the same app-owned tables as accounts/holdings/ledger), so this
 * is built on `useApiQuery` with the same stream-settle refetch backstop.
 *
 * The full household list is returned; consumers filter client-side by ticker
 * (the holding-row "has a thesis?" check, the report standing-thesis card). A
 * thesis is keyed household × ticker (upper-case), so a per-ticker lookup is a
 * cheap array find on the caller side.
 *
 * Convergence after a write: `session.sendAction("saveThesis"/"deleteThesis"/
 * "adoptThesis", ...)` resolves at the SSE response headers, BEFORE the
 * handler's DB write commits, and theses emit no `resource_change` to
 * auto-invalidate. So in addition to `useApiQuery`'s explicit `refetch` (called
 * by the pane after each action), this refetches on the true→false edge of
 * `isStreaming` — the write commits as the request completes, so that edge is
 * the correct settle point.
 */
export function useTheses(session: SessionView): {
  theses: ThesisRecord[];
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { data, refetch } = useApiQuery<{ theses: ThesisRecord[] }>(
    `/api/portfolio/theses?userId=${encodeURIComponent(uid)}`,
  );

  // Backstop: refetch when an in-flight action on this session completes, so a
  // write's committed result lands even though `sendAction` resolved earlier.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !session.isStreaming) refetch();
    wasStreaming.current = session.isStreaming;
  }, [session.isStreaming, refetch]);

  return { theses: data?.theses ?? [], refetch };
}
