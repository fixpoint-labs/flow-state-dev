"use client";

import { useMemo } from "react";
import { type SessionView, useResourceCollectionList } from "@flow-state-dev/react";
import type { ThesisRecord } from "@/src/flows/portfolio/thesis-schema";

/**
 * Read the household's per-position theses (FIX-760) from the user-scoped
 * `theses` resource collection. A thesis is an FSD resource (not a relational
 * table), so this is just `useResourceCollectionList` — the collection is
 * `client: { live: true }`, so a `saveThesis`/`deleteThesis`/`adoptThesis`
 * mutation streams back as a `resource_change` and the list updates with NO
 * manual refetch (the API-route + `useApiQuery` + stream-settle backstop the
 * table version needed are gone).
 *
 * The full household list is returned; consumers filter client-side by ticker
 * (the holding-row "has a thesis?" check, the report standing-thesis card). A
 * thesis is keyed `theses/{ticker}` (upper-case), so a per-ticker lookup is a
 * cheap array find on the caller side.
 *
 * `loading` is the first-read flag — distinct from a loaded-but-empty household —
 * so a consumer (the report's adopt button) can suppress an overwrite-adopt until
 * the read lands. `refetch` is retained for callers that want an explicit
 * re-pull, though the live stream makes it unnecessary in practice.
 */
export function useTheses(session: SessionView): {
  theses: ThesisRecord[];
  loading: boolean;
  refetch: () => void;
} {
  const { items, isLoading, refetch } = useResourceCollectionList<ThesisRecord>(
    session,
    "theses",
    // A household holds dozens of positions, not thousands — one page covers it.
    { limit: 200 },
  );
  const theses = useMemo(
    () =>
      items
        .map((item) => item.clientData)
        .filter((data): data is ThesisRecord => data != null),
    [items],
  );
  return { theses, loading: isLoading, refetch };
}
